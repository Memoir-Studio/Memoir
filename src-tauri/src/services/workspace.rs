use crate::{
    domain::{
        note_parse::{decode_utf8_prefix, parse_note, file_name_title, INDEX_READ_CAP, PARSE_ALGO_VERSION},
        path::normalize_root,
        AppError, AppResult, AttachmentFile, ErrorCode, NoteFile, NoteIdentity, WorkspaceIndexInfo,
    },
    infrastructure::{
        filesystem::{modified_ms, LocalFileSystem},
        sqlite::{self, NoteRow},
    },
};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, PoisonError,
    },
};
#[cfg(test)]
use std::sync::atomic::AtomicUsize;

#[derive(Debug, Clone)]
pub struct WorkspaceService {
    filesystem: LocalFileSystem,
    index: Arc<Mutex<Option<OpenWorkspaceIndex>>>,
    next_generation: Arc<AtomicU64>,
    #[cfg(test)]
    pub content_reads: Arc<AtomicUsize>,
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
    tags: Vec<String>,
}

impl Default for WorkspaceService {
    fn default() -> Self {
        Self::new(LocalFileSystem)
    }
}

impl WorkspaceService {
    pub fn new(filesystem: LocalFileSystem) -> Self {
        Self {
            filesystem,
            index: Arc::new(Mutex::new(None)),
            next_generation: Arc::new(AtomicU64::new(1)),
            #[cfg(test)]
            content_reads: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub fn scan(&self, root: &str) -> AppResult<Vec<NoteFile>> {
        let root_path = normalize_root(root)?;
        let discovered = self.filesystem.scan_workspace(root)?;
        let (generation, snapshot, parse_algo) = {
            let mut guard = self.lock_index();
            self.ensure_open_for_scan(&mut guard, &root_path);
            let open = guard.as_ref().expect("scan handle");
            let snapshot = sqlite::select_all_notes(&open.conn).unwrap_or_default();
            let parse_algo = sqlite::parse_algo_version(&open.conn).unwrap_or(PARSE_ALGO_VERSION);
            (open.generation, snapshot, parse_algo)
        };

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

        let mut parsed = Vec::new();
        let mut opened_ok = HashSet::new();
        let mut failed_open = HashSet::new();
        for (identity, expected_cas) in dirty {
            match self.read_prefix(&root_path, &identity) {
                None => {
                    failed_open.insert(identity.relative_path);
                }
                Some(opened) => {
                    opened_ok.insert(identity.relative_path.clone());
                    if opened.mtime != identity.modified_ms || opened.size != identity.size {
                        continue;
                    }
                    let parsed_note = if opened.decoded.is_empty() {
                        parse_note("", &identity.file_name)
                    } else {
                        parse_note(&opened.decoded, &identity.file_name)
                    };
                    let bytes_decoded = opened.decoded.len() as u64;
                    let row = sqlite::note_row(
                        identity.relative_path.clone(),
                        identity.file_name.clone(),
                        identity.extension.clone(),
                        opened.mtime,
                        opened.size,
                        hex_sha256(opened.decoded.as_bytes()),
                        opened.size > bytes_decoded,
                        parsed_note.title,
                        parsed_note.excerpt,
                        &parsed_note.tags,
                    );
                    parsed.push(ParsedDirty {
                        expected_cas,
                        walk: identity,
                        opened_mtime: opened.mtime,
                        opened_size: opened.size,
                        row,
                        tags: parsed_note.tags,
                    });
                }
            }
        }

        let merge = || {
            merge_payload(
                &discovered,
                &snapshot,
                &parsed,
                &failed_open,
                &opened_ok,
                &pending_delete,
            )
        };

        let mut guard = self.lock_index();
        let handle_ok = guard.as_ref().is_some_and(|open| {
            open.root == root_path && open.generation == generation
        });
        if !handle_ok {
            return Ok(merge());
        }
        let open = guard.as_mut().expect("scan handle");
        let committed = commit_reconcile(&mut open.conn, &pending_delete, &parsed);
        if committed {
            if let Ok(rows) = sqlite::select_all_notes(&open.conn) {
                return Ok(rows.into_iter().map(|row| row.to_note_file()).collect());
            }
        }
        Ok(merge())
    }

    pub fn read(&self, root: &str, relative_path: &str) -> AppResult<String> {
        self.filesystem.read_note(root, relative_path)
    }

    pub fn write(&self, root: &str, relative_path: &str, content: &str) -> AppResult<()> {
        self.filesystem.write_note(root, relative_path, content)?;
        if let Ok(root_path) = normalize_root(root) {
            let file_name = Path::new(relative_path)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(relative_path)
                .to_string();
            let extension = Path::new(relative_path)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let metadata = fs_metadata(&root_path.join(relative_path));
            self.try_write_through(&root_path, |conn| {
                let parsed = parse_note(content, &file_name);
                let row = sqlite::note_row(
                    relative_path.replace('\\', "/"),
                    file_name,
                    extension,
                    metadata.0,
                    metadata.1,
                    hex_sha256(content.as_bytes()),
                    false,
                    parsed.title,
                    parsed.excerpt,
                    &parsed.tags,
                );
                sqlite::upsert_note(conn, &row)?;
                sqlite::replace_tags(conn, &row.relative_path, &parsed.tags)?;
                Ok(())
            });
        }
        Ok(())
    }

    pub fn create(
        &self,
        root: &str,
        title: &str,
        extension: &str,
        folder: Option<&str>,
        tags: Option<&[String]>,
    ) -> AppResult<String> {
        let relative = self
            .filesystem
            .create_note(root, title, extension, folder, tags)?;
        if let (Ok(root_path), Ok(content)) = (normalize_root(root), self.filesystem.read_note(root, &relative))
        {
            let file_name = Path::new(&relative)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(&relative)
                .to_string();
            let ext = Path::new(&relative)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let metadata = fs_metadata(&root_path.join(&relative));
            self.try_write_through(&root_path, |conn| {
                let parsed = parse_note(&content, &file_name);
                let row = sqlite::note_row(
                    relative.clone(),
                    file_name,
                    ext,
                    metadata.0,
                    metadata.1,
                    hex_sha256(content.as_bytes()),
                    false,
                    parsed.title,
                    parsed.excerpt,
                    &parsed.tags,
                );
                sqlite::upsert_note(conn, &row)?;
                sqlite::replace_tags(conn, &row.relative_path, &parsed.tags)?;
                Ok(())
            });
        }
        Ok(relative)
    }

    pub fn rename(
        &self,
        root: &str,
        old_relative_path: &str,
        new_relative_path: &str,
    ) -> AppResult<String> {
        let renamed = self
            .filesystem
            .rename_note(root, old_relative_path, new_relative_path)?;
        if let Ok(root_path) = normalize_root(root) {
            let content = self.filesystem.read_note(root, &renamed).ok();
            let file_name = Path::new(&renamed)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(&renamed)
                .to_string();
            let extension = Path::new(&renamed)
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            let metadata = fs_metadata(&root_path.join(&renamed));
            self.try_write_through(&root_path, |conn| {
                sqlite::delete_note(conn, old_relative_path)?;
                if let Some(content) = content.as_deref() {
                    let parsed = parse_note(content, &file_name);
                    let row = sqlite::note_row(
                        renamed.clone(),
                        file_name,
                        extension,
                        metadata.0,
                        metadata.1,
                        hex_sha256(content.as_bytes()),
                        false,
                        parsed.title,
                        parsed.excerpt,
                        &parsed.tags,
                    );
                    sqlite::upsert_note(conn, &row)?;
                    sqlite::replace_tags(conn, &row.relative_path, &parsed.tags)?;
                }
                Ok(())
            });
        }
        Ok(renamed)
    }

    pub fn delete(&self, root: &str, relative_path: &str) -> AppResult<String> {
        let trashed = self.filesystem.delete_note(root, relative_path)?;
        if let Ok(root_path) = normalize_root(root) {
            self.try_write_through(&root_path, |conn| sqlite::delete_note(conn, relative_path));
        }
        Ok(trashed)
    }

    pub fn index_info(&self, root: &str) -> AppResult<WorkspaceIndexInfo> {
        let root_path = normalize_root(root)?;
        let mut guard = self.lock_index();
        self.ensure_open_for_scan(&mut guard, &root_path);
        let open = guard.as_ref().expect("index handle");
        Ok(sqlite::collect_index_info(
            &open.conn,
            &root_path,
            open.persistent,
        ))
    }

    pub fn rebuild_index(&self, root: &str) -> AppResult<WorkspaceIndexInfo> {
        let root_path = normalize_root(root)?;
        {
            let mut guard = self.lock_index();
            if let Some(open) = guard.take() {
                sqlite::checkpoint(&open.conn);
                drop(open);
            }
            let db_path = sqlite::index_dir(&root_path).join(sqlite::INDEX_FILE);
            if !sqlite::try_delete_triple(&db_path) {
                self.ensure_open_for_scan(&mut guard, &root_path);
                return Err(AppError::new(
                    ErrorCode::Io,
                    "Couldn't delete the index files.",
                ));
            }
            self.ensure_open_for_scan(&mut guard, &root_path);
        }
        self.scan(root)?;
        self.index_info(root)
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

    fn lock_index(&self) -> std::sync::MutexGuard<'_, Option<OpenWorkspaceIndex>> {
        self.index
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn ensure_open_for_scan(
        &self,
        guard: &mut Option<OpenWorkspaceIndex>,
        root: &Path,
    ) {
        if guard.as_ref().is_some_and(|open| open.root == root) {
            return;
        }
        if let Some(open) = guard.as_ref() {
            sqlite::checkpoint(&open.conn);
        }
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        let index = sqlite::open_or_rebuild(root);
        *guard = Some(OpenWorkspaceIndex {
            root: root.to_path_buf(),
            conn: index.conn,
            persistent: index.persistent,
            generation,
        });
    }

    fn try_write_through(
        &self,
        write_root: &Path,
        op: impl FnOnce(&rusqlite::Connection) -> rusqlite::Result<()>,
    ) {
        match self.index.try_lock() {
            Ok(mut guard) => {
                let Some(open) = guard.as_mut() else {
                    return;
                };
                if open.root != write_root {
                    return;
                }
                let _ = op(&open.conn);
            }
            Err(std::sync::TryLockError::WouldBlock) => {}
            Err(std::sync::TryLockError::Poisoned(poisoned)) => {
                let mut guard = poisoned.into_inner();
                let Some(open) = guard.as_mut() else {
                    return;
                };
                if open.root != write_root {
                    return;
                }
                let _ = op(&open.conn);
            }
        }
    }

    fn read_prefix(&self, root: &Path, identity: &NoteIdentity) -> Option<OpenedPrefix> {
        #[cfg(test)]
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
) -> bool {
    let Ok(txn) = conn.transaction() else {
        return false;
    };
    for (path, mtime, size) in pending_delete {
        if sqlite::cas_delete(&txn, path, *mtime, *size).is_err() {
            return false;
        }
    }
    for item in parsed {
        if item.opened_mtime != item.walk.modified_ms || item.opened_size != item.walk.size {
            continue;
        }
        let affected = match item.expected_cas {
            Some((mtime, size)) => sqlite::cas_update(&txn, &item.row, mtime, size),
            None => sqlite::insert_ignore(&txn, &item.row),
        };
        let Ok(affected) = affected else {
            return false;
        };
        if affected == 1 && sqlite::replace_tags(&txn, &item.walk.relative_path, &item.tags).is_err()
        {
            return false;
        }
    }
    if sqlite::set_meta(
        &txn,
        "last_reconcile_ms",
        &sqlite::now_ms().to_string(),
    )
    .is_err()
        || sqlite::set_meta(&txn, "index_read_cap", &INDEX_READ_CAP.to_string()).is_err()
    {
        return false;
    }
    txn.commit().is_ok()
}

fn merge_payload(
    discovered: &[NoteIdentity],
    snapshot: &[NoteRow],
    parsed: &[ParsedDirty],
    failed_open: &HashSet<String>,
    opened_ok: &HashSet<String>,
    pending_delete: &[(String, i64, i64)],
) -> Vec<NoteFile> {
    let deleted = pending_delete
        .iter()
        .map(|(path, _, _)| path.as_str())
        .collect::<HashSet<_>>();
    let mut by_path = HashMap::new();
    for row in snapshot {
        if deleted.contains(row.relative_path.as_str()) {
            continue;
        }
        by_path.insert(row.relative_path.clone(), row.to_note_file());
    }
    for item in parsed {
        if item.opened_mtime == item.walk.modified_ms && item.opened_size == item.walk.size {
            by_path.insert(item.walk.relative_path.clone(), item.row.to_note_file());
        }
    }
    for item in discovered {
        if failed_open.contains(&item.relative_path) {
            if !by_path.contains_key(&item.relative_path) {
                continue;
            }
            continue;
        }
        if by_path.contains_key(&item.relative_path) {
            continue;
        }
        if opened_ok.contains(&item.relative_path) {
            let title = file_name_title(&item.file_name);
            by_path.insert(
                item.relative_path.clone(),
                NoteFile {
                    relative_path: item.relative_path.clone(),
                    file_name: item.file_name.clone(),
                    extension: item.extension.clone(),
                    modified_ms: item.modified_ms,
                    size: item.size,
                    title: if title.is_empty() {
                        "Untitled".into()
                    } else {
                        title
                    },
                    tags: Vec::new(),
                    excerpt: String::new(),
                },
            );
        }
    }
    let mut notes = by_path.into_values().collect::<Vec<_>>();
    notes.sort_by(|left, right| {
        right
            .modified_ms
            .cmp(&left.modified_ms)
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    notes
}

fn hex_sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn fs_metadata(path: &Path) -> (u128, u64) {
    fs::metadata(path)
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

use std::fs;
