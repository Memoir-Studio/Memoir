use crate::{
    domain::{
        note_parse::{decode_utf8_prefix, parse_note, INDEX_READ_CAP, PARSE_ALGO_VERSION},
        path::normalize_root,
        AppError, AppResult, AttachmentFile, ErrorCode, LibraryPage, LibraryQuery, NoteFile,
        NoteIdentity, RenamedNote, WorkspaceIndexInfo,
    },
    infrastructure::{
        filesystem::{modified_ms, LocalFileSystem},
        index::{
            self, cas_delete, cas_update, delete_note, insert_ignore, load_dir_cache, note_row,
            replace_dir_cache, select_identities, set_meta, upsert_note, DirCacheRow,
            NoteIdentityRow, NoteRow,
        },
    },
};
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex, PoisonError,
    },
};

const PARSE_THREADS: usize = 8;

#[derive(Debug, Clone)]
pub struct WorkspaceService {
    filesystem: LocalFileSystem,
    index: Arc<Mutex<Option<OpenWorkspaceIndex>>>,
    next_generation: Arc<AtomicU64>,
    pub content_reads: Arc<AtomicUsize>,
    #[cfg(test)]
    pub walk_dirs: Arc<AtomicUsize>,
}

#[derive(Debug)]
struct OpenWorkspaceIndex {
    root: PathBuf,
    conn: rusqlite::Connection,
    persistent: bool,
    generation: u64,
}

struct OpenedPrefix {
    decoded: String,
    mtime: u128,
    size: u64,
}

struct ParsedDirty {
    expected_cas: Option<(i64, i64)>,
    walk: NoteIdentity,
    opened_mtime: u128,
    opened_size: u64,
    row: NoteRow,
}

impl Default for WorkspaceService {
    fn default() -> Self {
        Self::new(LocalFileSystem::new())
    }
}

impl WorkspaceService {
    pub fn new(filesystem: LocalFileSystem) -> Self {
        Self {
            #[cfg(test)]
            walk_dirs: filesystem.walk_dirs.clone(),
            filesystem,
            index: Arc::new(Mutex::new(None)),
            next_generation: Arc::new(AtomicU64::new(1)),
            content_reads: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub fn reconcile(&self, root: &str, query: &LibraryQuery) -> AppResult<LibraryPage> {
        self.reconcile_disk(root)?;
        self.query_library(root, query)
    }

    #[cfg(test)]
    pub fn scan(&self, root: &str) -> AppResult<Vec<NoteFile>> {
        Ok(self.reconcile(root, &LibraryQuery::default())?.notes)
    }

    pub fn query_library(&self, root: &str, query: &LibraryQuery) -> AppResult<LibraryPage> {
        let root_path = normalize_root(root)?;
        let mut guard = self.lock_index();
        self.ensure_open(&mut guard, &root_path);
        let open = guard.as_ref().expect("index handle");
        index::query_library(&open.conn, query).map_err(|error| {
            AppError::new(ErrorCode::Io, "Couldn't query the library index.")
                .with_details(error.to_string())
        })
    }

    fn reconcile_disk(&self, root: &str) -> AppResult<()> {
        let root_path = normalize_root(root)?;
        let (generation, snapshot, parse_algo, cache) = {
            let mut guard = self.lock_index();
            self.ensure_open(&mut guard, &root_path);
            let open = guard.as_ref().expect("scan handle");
            let snapshot = select_identities(&open.conn).unwrap_or_default();
            let parse_algo = index::parse_algo_version(&open.conn).unwrap_or(PARSE_ALGO_VERSION);
            let cache = load_dir_cache(&open.conn).unwrap_or_default();
            (open.generation, snapshot, parse_algo, cache)
        };

        let known: Vec<NoteIdentity> = snapshot.iter().map(identity_from_row).collect();
        let walk = self.filesystem.walk_workspace(root, &cache, &known)?;
        // Cache-hit dirs skip read_dir but still stat known files, so identities
        // here are current. Do not overlay snapshot rows — that would hide
        // in-place edits and resurrect deleted notes.
        let discovered = walk.notes;

        let snapshot_by_path = snapshot
            .iter()
            .cloned()
            .map(|row| (row.relative_path.clone(), row))
            .collect::<HashMap<_, _>>();
        let disk_paths = discovered
            .iter()
            .map(|item| item.relative_path.clone())
            .collect::<HashSet<_>>();

        let pending_delete = snapshot
            .iter()
            .filter(|row| !disk_paths.contains(&row.relative_path))
            .map(|row| (row.relative_path.clone(), row.modified_ms, row.size))
            .collect::<Vec<_>>();

        let force_reparse = parse_algo != PARSE_ALGO_VERSION;
        let mut dirty = Vec::new();
        for item in &discovered {
            match snapshot_by_path.get(&item.relative_path) {
                None => dirty.push((item.clone(), None)),
                Some(row) => {
                    let identity_changed = row.modified_ms as u128 != item.modified_ms
                        || row.size as u64 != item.size;
                    let truncated_fits =
                        row.parse_truncated == 1 && item.size <= INDEX_READ_CAP as u64;
                    if force_reparse || identity_changed || truncated_fits {
                        dirty.push((item.clone(), Some((row.modified_ms, row.size))));
                    }
                }
            }
        }

        let parsed = self.parse_dirty_parallel(&root_path, dirty);

        let mut guard = self.lock_index();
        let handle_ok = guard
            .as_ref()
            .is_some_and(|open| open.root == root_path && open.generation == generation);
        if !handle_ok {
            return Ok(());
        }
        let open = guard.as_mut().expect("scan handle");
        if commit_reconcile(
            &mut open.conn,
            &pending_delete,
            &parsed,
            &walk.walked_dirs,
            &walk.reused_dirs,
        ) {
            index::optimize(&open.conn);
        }
        Ok(())
    }

    pub fn read(&self, root: &str, relative_path: &str) -> AppResult<String> {
        self.filesystem.read_note(root, relative_path)
    }

    pub fn write(&self, root: &str, relative_path: &str, content: &str) -> AppResult<NoteFile> {
        self.filesystem.write_note(root, relative_path, content)?;
        self.index_written_note(root, relative_path, Some(content))
    }

    pub fn create(
        &self,
        root: &str,
        title: &str,
        extension: &str,
        folder: Option<&str>,
        tags: Option<&[String]>,
    ) -> AppResult<NoteFile> {
        let relative = self
            .filesystem
            .create_note(root, title, extension, folder, tags)?;
        self.index_written_note(root, &relative, None)
    }

    pub fn rename(
        &self,
        root: &str,
        old_relative_path: &str,
        new_relative_path: &str,
    ) -> AppResult<RenamedNote> {
        let renamed = self
            .filesystem
            .rename_note(root, old_relative_path, new_relative_path)?;
        if let Ok(root_path) = normalize_root(root) {
            self.write_through(&root_path, |conn| delete_note(conn, old_relative_path));
        }
        let note = self.index_written_note(root, &renamed, None)?;
        Ok(RenamedNote {
            old_path: old_relative_path.replace('\\', "/"),
            note,
        })
    }

    pub fn delete(&self, root: &str, relative_path: &str) -> AppResult<String> {
        let trashed = self.filesystem.delete_note(root, relative_path)?;
        if let Ok(root_path) = normalize_root(root) {
            self.write_through(&root_path, |conn| delete_note(conn, relative_path));
        }
        Ok(trashed)
    }

    pub fn index_info(&self, root: &str) -> AppResult<WorkspaceIndexInfo> {
        let root_path = normalize_root(root)?;
        let mut guard = self.lock_index();
        self.ensure_open(&mut guard, &root_path);
        let open = guard.as_ref().expect("index handle");
        Ok(index::collect_index_info(
            &open.conn,
            &root_path,
            open.persistent,
        ))
    }

    pub fn rebuild_index(&self, root: &str, query: &LibraryQuery) -> AppResult<LibraryPage> {
        let root_path = normalize_root(root)?;
        {
            let mut guard = self.lock_index();
            if let Some(open) = guard.take() {
                index::checkpoint(&open.conn);
                drop(open);
            }
            let db_path = index::index_dir(&root_path).join(index::INDEX_FILE);
            if !index::try_delete_triple(&db_path) {
                self.ensure_open(&mut guard, &root_path);
                return Err(AppError::new(
                    ErrorCode::Io,
                    "Couldn't delete the index files.",
                ));
            }
            self.ensure_open(&mut guard, &root_path);
        }
        self.reconcile(root, query)
    }

    pub fn scan_attachments(&self, root: &str) -> AppResult<Vec<AttachmentFile>> {
        self.filesystem.scan_attachments(root)
    }

    pub fn save_attachment(
        &self,
        root: &str,
        bytes_base64: &str,
        file_name: Option<&str>,
        mime_type: Option<&str>,
    ) -> AppResult<AttachmentFile> {
        let bytes = decode_attachment_bytes(bytes_base64)?;
        self.filesystem
            .save_attachment(root, &bytes, file_name, mime_type)
    }

    pub fn import_attachment(&self, root: &str, source_path: &str) -> AppResult<AttachmentFile> {
        self.filesystem.import_attachment(root, source_path)
    }

    pub fn delete_attachment(&self, root: &str, relative_path: &str) -> AppResult<String> {
        self.filesystem.delete_attachment(root, relative_path)
    }

    pub fn write_export_file(&self, path: &str, bytes_base64: &str) -> AppResult<()> {
        let bytes = decode_base64(bytes_base64, "Export data is not valid base64.")?;
        self.filesystem.write_export_file(path, &bytes)
    }

    fn index_written_note(
        &self,
        root: &str,
        relative_path: &str,
        known_content: Option<&str>,
    ) -> AppResult<NoteFile> {
        let root_path = normalize_root(root)?;
        let owned;
        let content = if let Some(content) = known_content {
            content
        } else {
            owned = self.filesystem.read_note(root, relative_path)?;
            &owned
        };
        let relative = relative_path.replace('\\', "/");
        let file_name = Path::new(&relative)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(&relative)
            .to_string();
        let extension = Path::new(&relative)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let metadata = fs_metadata(&root_path.join(&relative));
        let parsed = parse_note(content, &file_name);
        let row = note_row(
            relative,
            file_name,
            extension,
            metadata.0,
            metadata.1,
            false,
            parsed.title,
            parsed.excerpt,
            &parsed.tags,
        );
        self.write_through(&root_path, |conn| {
            upsert_note(conn, &row)?;
            Ok(())
        });
        Ok(row.to_note_file())
    }

    fn lock_index(&self) -> std::sync::MutexGuard<'_, Option<OpenWorkspaceIndex>> {
        self.index.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn ensure_open(&self, guard: &mut Option<OpenWorkspaceIndex>, root: &Path) {
        if guard.as_ref().is_some_and(|open| open.root == root) {
            return;
        }
        if let Some(open) = guard.as_ref() {
            index::checkpoint(&open.conn);
        }
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        let opened = index::open_or_rebuild(root);
        *guard = Some(OpenWorkspaceIndex {
            root: root.to_path_buf(),
            conn: opened.conn,
            persistent: opened.persistent,
            generation,
        });
    }

    fn write_through(
        &self,
        write_root: &Path,
        op: impl FnOnce(&rusqlite::Connection) -> rusqlite::Result<()>,
    ) {
        let mut guard = self.lock_index();
        let Some(open) = guard.as_mut() else {
            return;
        };
        if open.root != write_root {
            return;
        }
        let _ = op(&open.conn);
    }

    fn parse_dirty_parallel(
        &self,
        root: &Path,
        dirty: Vec<(NoteIdentity, Option<(i64, i64)>)>,
    ) -> Vec<ParsedDirty> {
        if dirty.is_empty() {
            return Vec::new();
        }
        let workers = dirty.len().min(PARSE_THREADS).max(1);
        std::thread::scope(|scope| {
            let mut handles = Vec::with_capacity(workers);
            for worker_id in 0..workers {
                let items = &dirty;
                handles.push(scope.spawn(move || {
                    let mut out = Vec::new();
                    for (index, (identity, expected_cas)) in items.iter().enumerate() {
                        if index % workers != worker_id {
                            continue;
                        }
                        if let Some(parsed) = self.parse_one(root, identity, *expected_cas) {
                            out.push(parsed);
                        }
                    }
                    out
                }));
            }
            handles
                .into_iter()
                .flat_map(|handle| handle.join().unwrap_or_default())
                .collect()
        })
    }

    fn parse_one(
        &self,
        root: &Path,
        identity: &NoteIdentity,
        expected_cas: Option<(i64, i64)>,
    ) -> Option<ParsedDirty> {
        let opened = self.read_prefix(root, identity)?;
        if opened.mtime != identity.modified_ms || opened.size != identity.size {
            return None;
        }
        let parsed_note = if opened.decoded.is_empty() {
            parse_note("", &identity.file_name)
        } else {
            parse_note(&opened.decoded, &identity.file_name)
        };
        let bytes_decoded = opened.decoded.len() as u64;
        Some(ParsedDirty {
            expected_cas,
            walk: identity.clone(),
            opened_mtime: opened.mtime,
            opened_size: opened.size,
            row: note_row(
                identity.relative_path.clone(),
                identity.file_name.clone(),
                identity.extension.clone(),
                opened.mtime,
                opened.size,
                opened.size > bytes_decoded,
                parsed_note.title,
                parsed_note.excerpt,
                &parsed_note.tags,
            ),
        })
    }

    fn read_prefix(&self, root: &Path, identity: &NoteIdentity) -> Option<OpenedPrefix> {
        self.content_reads.fetch_add(1, Ordering::Relaxed);
        let path = root.join(&identity.relative_path);
        let mut file = File::open(&path).ok()?;
        let mut bytes = Vec::new();
        file.by_ref()
            .take(INDEX_READ_CAP as u64)
            .read_to_end(&mut bytes)
            .ok()?;
        let metadata = file.metadata().ok()?;
        let decoded = decode_utf8_prefix(&bytes);
        Some(OpenedPrefix {
            decoded,
            mtime: modified_ms(metadata.modified()),
            size: metadata.len(),
        })
    }
}

fn commit_reconcile(
    conn: &mut rusqlite::Connection,
    pending_delete: &[(String, i64, i64)],
    parsed: &[ParsedDirty],
    walked_dirs: &[DirCacheRow],
    reused_dirs: &[String],
) -> bool {
    let Ok(txn) = conn.transaction() else {
        return false;
    };
    for (path, mtime, size) in pending_delete {
        if cas_delete(&txn, path, *mtime, *size).is_err() {
            return false;
        }
    }
    for item in parsed {
        if item.opened_mtime != item.walk.modified_ms || item.opened_size != item.walk.size {
            continue;
        }
        let affected = match item.expected_cas {
            Some((mtime, size)) => cas_update(&txn, &item.row, mtime, size),
            None => insert_ignore(&txn, &item.row),
        };
        if affected.is_err() {
            return false;
        }
    }
    if replace_dir_cache(&txn, walked_dirs, reused_dirs).is_err()
        || set_meta(&txn, "last_reconcile_ms", &index::now_ms().to_string()).is_err()
        || set_meta(&txn, "index_read_cap", &INDEX_READ_CAP.to_string()).is_err()
        || set_meta(
            &txn,
            "parse_algo_version",
            &PARSE_ALGO_VERSION.to_string(),
        )
        .is_err()
    {
        return false;
    }
    txn.commit().is_ok()
}

fn identity_from_row(row: &NoteIdentityRow) -> NoteIdentity {
    let file_name = row
        .relative_path
        .rsplit('/')
        .next()
        .unwrap_or(&row.relative_path)
        .to_string();
    let extension = Path::new(&file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    NoteIdentity {
        relative_path: row.relative_path.clone(),
        file_name,
        extension,
        modified_ms: row.modified_ms.max(0) as u128,
        size: row.size.max(0) as u64,
    }
}

fn fs_metadata(path: &Path) -> (u128, u64) {
    std::fs::metadata(path)
        .map(|metadata| (modified_ms(metadata.modified()), metadata.len()))
        .unwrap_or((0, 0))
}

fn decode_attachment_bytes(bytes_base64: &str) -> AppResult<Vec<u8>> {
    decode_base64(bytes_base64, "Attachment data is not valid base64.")
}

fn decode_base64(bytes_base64: &str, message: &str) -> AppResult<Vec<u8>> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    STANDARD.decode(bytes_base64.trim()).map_err(|error| {
        crate::domain::AppError::new(crate::domain::ErrorCode::Io, message)
            .with_details(error.to_string())
    })
}

