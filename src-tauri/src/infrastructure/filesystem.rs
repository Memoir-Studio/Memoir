use crate::{
    domain::{
        attachment::{
            attachment_month_dir, mime_from_extension, resolve_attachment_extension,
            sanitize_attachment_file_name, unique_file_name, ATTACHMENTS_DIR,
            LEGACY_ATTACHMENTS_DIR,
        },
        folder_of,
        path::{
            create_parent_dirs, is_supported_note, normalize_root, resolve_existing_attachment,
            resolve_existing_note, resolve_new_attachment, resolve_new_note, should_skip_dir,
            to_relative_path, validate_nearest_existing_parent, validate_note_extension,
            validate_relative_path,
        },
        AppError, AppResult, AttachmentFile, NoteIdentity,
    },
    infrastructure::{
        atomic::atomic_write,
        index::DirCacheRow,
    },
};
use std::{
    collections::HashMap,
    fs, io,
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::SystemTime,
};

#[derive(Debug, Clone)]
pub struct LocalFileSystem {
    pub walk_dirs: Arc<AtomicUsize>,
}

impl Default for LocalFileSystem {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalFileSystem {
    pub fn new() -> Self {
        Self {
            walk_dirs: Arc::new(AtomicUsize::new(0)),
        }
    }

    #[cfg(test)]
    pub fn scan_workspace(&self, root: &str) -> AppResult<Vec<NoteIdentity>> {
        Ok(self.walk_workspace(root, &HashMap::new(), &[])?.notes)
    }

    pub fn walk_workspace(
        &self,
        root: &str,
        cache: &HashMap<String, DirCacheRow>,
        known_notes: &[NoteIdentity],
    ) -> AppResult<WorkspaceWalk> {
        let root = normalize_root(root)?;
        let mut walk = WorkspaceWalk::default();
        collect_notes(&root, &root, cache, known_notes, &mut walk, &self.walk_dirs)?;
        walk.notes.sort_by(|left, right| {
            right
                .modified_ms
                .cmp(&left.modified_ms)
                .then_with(|| left.relative_path.cmp(&right.relative_path))
        });
        Ok(walk)
    }

    pub fn read_note(&self, root: &str, relative_path: &str) -> AppResult<String> {
        let (_, path) = resolve_existing_note(root, relative_path)?;
        fs::read_to_string(&path).map_err(|error| AppError::io("Read note", &path, error))
    }

    pub fn write_note(&self, root: &str, relative_path: &str, content: &str) -> AppResult<()> {
        let (root_path, target) = match resolve_existing_note(root, relative_path) {
            Ok(result) => result,
            Err(error) if error.code == crate::domain::ErrorCode::NotFound => {
                resolve_new_note(root, relative_path)?
            }
            Err(error) => return Err(error),
        };
        create_parent_dirs(&root_path, &target)?;
        atomic_write(&target, content.as_bytes())
    }

    pub fn write_export_file(&self, path: &str, bytes: &[u8]) -> AppResult<()> {
        let path = validate_export_path(path)?;
        atomic_write(&path, bytes)
    }

    pub fn create_note(
        &self,
        root: &str,
        title: &str,
        extension: &str,
        folder: Option<&str>,
        tags: Option<&[String]>,
    ) -> AppResult<String> {
        let root = normalize_root(root)?;
        let extension = extension.trim_start_matches('.').to_ascii_lowercase();
        validate_note_extension(Path::new(&format!("note.{extension}")))?;
        let folder = validate_optional_directory(folder)?;
        let target_dir = folder
            .as_ref()
            .map(|path| root.join(path))
            .unwrap_or_else(|| root.clone());
        validate_nearest_existing_parent(&root, &target_dir.join(".memoir-parent-check"))?;
        fs::create_dir_all(&target_dir)
            .map_err(|error| AppError::io("Create note folder", &target_dir, error))?;
        let canonical_dir = target_dir
            .canonicalize()
            .map_err(|error| AppError::io("Resolve note folder", &target_dir, error))?;
        crate::domain::path::ensure_inside(&root, &canonical_dir)?;

        let slug = slugify(title);
        let tags = yaml_tags(tags);
        for index in 0..1000 {
            let file_name = if index == 0 {
                format!("{slug}.{extension}")
            } else {
                format!("{slug}-{index}.{extension}")
            };
            let path = canonical_dir.join(file_name);
            if !path.exists() {
                let heading = if title.trim().is_empty() {
                    "Untitled"
                } else {
                    title.trim()
                };
                let content = format!(
                    "---\ntitle: {}\ntags: {tags}\n---\n\n# {heading}\n",
                    yaml_quote(heading)
                );
                atomic_write(&path, content.as_bytes())?;
                return to_relative_path(&root, &path);
            }
        }
        Err(AppError::conflict("Unable to find a unique file name."))
    }

    pub fn rename_note(
        &self,
        root: &str,
        old_relative_path: &str,
        new_relative_path: &str,
    ) -> AppResult<String> {
        let (root, old_path) = resolve_existing_note(root, old_relative_path)?;
        let relative = validate_relative_path(new_relative_path)?;
        validate_note_extension(&relative)?;
        let new_path = root.join(&relative);
        if new_path.exists() {
            return Err(AppError::conflict(
                "A note already exists at the target path.",
            ));
        }
        validate_nearest_existing_parent(&root, &new_path)?;
        create_parent_dirs(&root, &new_path)?;
        fs::rename(&old_path, &new_path)
            .map_err(|error| AppError::io("Rename note", &old_path, error))?;
        to_relative_path(&root, &new_path)
    }

    pub fn delete_note(&self, root: &str, relative_path: &str) -> AppResult<String> {
        let (root, note_path) = resolve_existing_note(root, relative_path)?;
        move_to_workspace_trash(&root, &note_path, "deleted-note.md")
    }

    pub fn scan_attachments(&self, root: &str) -> AppResult<Vec<AttachmentFile>> {
        let root = normalize_root(root)?;
        let mut attachments = Vec::new();
        for dir_name in [ATTACHMENTS_DIR, LEGACY_ATTACHMENTS_DIR] {
            collect_attachment_tree(&root, &root.join(dir_name), &mut attachments)?;
        }
        attachments.sort_by(|left, right| {
            right
                .modified_ms
                .cmp(&left.modified_ms)
                .then_with(|| left.relative_path.cmp(&right.relative_path))
        });
        Ok(attachments)
    }

    pub fn save_attachment(
        &self,
        root: &str,
        bytes: &[u8],
        file_name: Option<&str>,
        mime_type: Option<&str>,
    ) -> AppResult<AttachmentFile> {
        write_attachment_bytes(root, bytes, file_name, mime_type)
    }

    pub fn import_attachment(&self, root: &str, source_path: &str) -> AppResult<AttachmentFile> {
        let source = PathBuf::from(source_path);
        if !source.exists() {
            return Err(AppError::not_found("Source file does not exist."));
        }
        let bytes =
            fs::read(&source).map_err(|error| AppError::io("Read source attachment", &source, error))?;
        let file_name = source
            .file_name()
            .and_then(|value| value.to_str());
        write_attachment_bytes(root, &bytes, file_name, None)
    }

    pub fn delete_attachment(&self, root: &str, relative_path: &str) -> AppResult<String> {
        let (root, attachment_path) = resolve_existing_attachment(root, relative_path)?;
        move_to_workspace_trash(&root, &attachment_path, "deleted-attachment")
    }
}

fn write_attachment_bytes(
    root: &str,
    bytes: &[u8],
    file_name: Option<&str>,
    mime_type: Option<&str>,
) -> AppResult<AttachmentFile> {
    let extension = resolve_attachment_extension(file_name, mime_type, bytes)?;
    let stem = file_name
        .map(sanitize_attachment_file_name)
        .map(|name| {
            Path::new(&name)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("image")
                .to_string()
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "image".into());
    let preferred = format!("{stem}.{extension}");
    let root_path = normalize_root(root)?;
    let month = attachment_month_dir();
    let attachments_dir = root_path.join(ATTACHMENTS_DIR);
    let month_dir = attachments_dir.join(&month);
    fs::create_dir_all(&month_dir)
        .map_err(|error| AppError::io("Create attachments directory", &month_dir, error))?;
    let canonical_dir = attachments_dir
        .canonicalize()
        .map_err(|error| AppError::io("Resolve attachments directory", &attachments_dir, error))?;
    crate::domain::path::ensure_inside(&root_path, &canonical_dir)?;
    let unique_name = unique_file_name(&preferred, |candidate| {
        canonical_dir.join(&month).join(candidate).exists()
    });
    let relative = format!("{ATTACHMENTS_DIR}/{month}/{unique_name}");
    let (_, target) = resolve_new_attachment(root, &relative)?;
    create_parent_dirs(&root_path, &target)?;
    atomic_write(&target, bytes)?;
    attachment_file_from_path(&root_path, &target)
}

fn collect_attachment_tree(
    root: &Path,
    attachments_dir: &Path,
    attachments: &mut Vec<AttachmentFile>,
) -> AppResult<()> {
    if !attachments_dir.exists() {
        return Ok(());
    }
    let metadata = fs::symlink_metadata(attachments_dir)
        .map_err(|error| AppError::io("Inspect attachments directory", attachments_dir, error))?;
    if metadata.file_type().is_symlink() {
        return Err(AppError::invalid_path(
            "Attachments directory cannot be a symbolic link.",
        ));
    }
    if !metadata.is_dir() {
        return Err(AppError::invalid_path(
            "Attachments path is not a directory.",
        ));
    }
    collect_attachments(root, attachments_dir, attachments)
}

fn collect_attachments(
    root: &Path,
    current: &Path,
    attachments: &mut Vec<AttachmentFile>,
) -> AppResult<()> {
    let entries =
        fs::read_dir(current).map_err(|error| AppError::io("Read attachments", current, error))?;
    for entry in entries {
        let entry = entry.map_err(|error| {
            AppError::new(
                crate::domain::ErrorCode::Io,
                "Unable to read attachment entry.",
            )
            .with_details(error.to_string())
        })?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| AppError::io("Inspect attachment entry", &path, error))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            if !should_skip_dir(&path) {
                collect_attachments(root, &path, attachments)?;
            }
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if file_name.starts_with('.') {
            continue;
        }
        if crate::domain::attachment::validate_attachment_extension(&path).is_err() {
            continue;
        }
        attachments.push(attachment_file_from_metadata(root, &path, &metadata)?);
    }
    Ok(())
}

fn attachment_file_from_path(root: &Path, path: &Path) -> AppResult<AttachmentFile> {
    let metadata =
        fs::metadata(path).map_err(|error| AppError::io("Inspect saved attachment", path, error))?;
    attachment_file_from_metadata(root, path, &metadata)
}

fn attachment_file_from_metadata(
    root: &Path,
    path: &Path,
    metadata: &fs::Metadata,
) -> AppResult<AttachmentFile> {
    let relative_path = to_relative_path(root, path)?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    Ok(AttachmentFile {
        relative_path,
        file_name,
        extension: extension.clone(),
        mime_type: mime_from_extension(&extension).to_string(),
        modified_ms: modified_ms(metadata.modified()),
        size: metadata.len(),
    })
}

fn move_to_workspace_trash(root: &Path, file_path: &Path, fallback_name: &str) -> AppResult<String> {
    let trash = root.join(".memoir-trash");
    if trash.exists() {
        let metadata = fs::symlink_metadata(&trash)
            .map_err(|error| AppError::io("Inspect trash directory", &trash, error))?;
        if metadata.file_type().is_symlink() {
            return Err(AppError::invalid_path(
                "Trash directory cannot be a symbolic link.",
            ));
        }
    }
    fs::create_dir_all(&trash)
        .map_err(|error| AppError::io("Create trash directory", &trash, error))?;
    let canonical_trash = trash
        .canonicalize()
        .map_err(|error| AppError::io("Resolve trash directory", &trash, error))?;
    crate::domain::path::ensure_inside(root, &canonical_trash)?;
    let file_name = file_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(fallback_name);
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let target = unique_trash_path(&canonical_trash, timestamp, file_name);
    fs::rename(file_path, &target)
        .map_err(|error| AppError::io("Move file to trash", file_path, error))?;
    to_relative_path(root, &target)
}

#[derive(Debug, Default, Clone)]
pub struct WorkspaceWalk {
    pub notes: Vec<NoteIdentity>,
    pub walked_dirs: Vec<DirCacheRow>,
    pub reused_dirs: Vec<String>,
}

fn relative_dir(root: &Path, current: &Path) -> String {
    if current == root {
        return String::new();
    }
    to_relative_path(root, current).unwrap_or_default()
}

fn is_direct_child_dir(parent: &str, child: &str) -> bool {
    if parent == child || child.is_empty() {
        return false;
    }
    if parent.is_empty() {
        return !child.contains('/');
    }
    child
        .strip_prefix(parent)
        .and_then(|rest| rest.strip_prefix('/'))
        .is_some_and(|rest| !rest.is_empty() && !rest.contains('/'))
}

fn collect_notes(
    root: &Path,
    current: &Path,
    cache: &HashMap<String, DirCacheRow>,
    known_notes: &[NoteIdentity],
    walk: &mut WorkspaceWalk,
    walk_dirs: &AtomicUsize,
) -> AppResult<()> {
    let dir_key = relative_dir(root, current);
    let dir_meta = match fs::symlink_metadata(current) {
        Ok(metadata) => metadata,
        Err(_) => return Ok(()),
    };
    if dir_meta.file_type().is_symlink() || !dir_meta.is_dir() {
        return Ok(());
    }
    let dir_mtime = i64::try_from(modified_ms(dir_meta.modified())).unwrap_or(i64::MAX);
    let dir_size = i64::try_from(dir_meta.len()).unwrap_or(i64::MAX);
    if let Some(cached) = cache.get(&dir_key) {
        if cached.modified_ms == dir_mtime && cached.size == dir_size {
            // Skip read_dir of this directory only. Still stat known files and
            // visit each cached child dir — ancestor mtime is not proof a child is unchanged.
            walk.reused_dirs.push(dir_key.clone());
            stat_known_notes(root, &dir_key, known_notes, walk);
            visit_cached_children(root, &dir_key, cache, known_notes, walk, walk_dirs)?;
            return Ok(());
        }
    }

    walk_dirs.fetch_add(1, Ordering::Relaxed);
    let entries =
        fs::read_dir(current).map_err(|error| AppError::io("Read directory", current, error))?;
    let mut entry_count = 0_i64;
    for entry in entries {
        let entry = entry.map_err(|error| {
            AppError::new(
                crate::domain::ErrorCode::Io,
                "Unable to read directory entry.",
            )
            .with_details(error.to_string())
        })?;
        entry_count += 1;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| AppError::io("Inspect workspace entry", &path, error))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            if !should_skip_dir(&path) {
                collect_notes(root, &path, cache, known_notes, walk, walk_dirs)?;
            }
            continue;
        }
        if metadata.is_file() && is_supported_note(&path) {
            if let Some(identity) = note_identity_from_metadata(root, &path, &metadata) {
                walk.notes.push(identity);
            }
        }
    }
    walk.walked_dirs.push(DirCacheRow {
        relative_dir: dir_key,
        modified_ms: dir_mtime,
        size: dir_size,
        entry_count,
    });
    Ok(())
}

fn stat_known_notes(
    root: &Path,
    dir_key: &str,
    known_notes: &[NoteIdentity],
    walk: &mut WorkspaceWalk,
) {
    for note in known_notes {
        if folder_of(&note.relative_path) != dir_key {
            continue;
        }
        let path = root.join(&note.relative_path);
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() || !is_supported_note(&path) {
            continue;
        }
        if let Some(identity) = note_identity_from_metadata(root, &path, &metadata) {
            walk.notes.push(identity);
        }
    }
}

fn visit_cached_children(
    root: &Path,
    dir_key: &str,
    cache: &HashMap<String, DirCacheRow>,
    known_notes: &[NoteIdentity],
    walk: &mut WorkspaceWalk,
    walk_dirs: &AtomicUsize,
) -> AppResult<()> {
    let children = cache
        .keys()
        .filter(|child| is_direct_child_dir(dir_key, child))
        .cloned()
        .collect::<Vec<_>>();
    for child in children {
        let path = root.join(&child);
        if should_skip_dir(&path) {
            continue;
        }
        collect_notes(root, &path, cache, known_notes, walk, walk_dirs)?;
    }
    Ok(())
}

fn note_identity_from_metadata(
    root: &Path,
    path: &Path,
    metadata: &fs::Metadata,
) -> Option<NoteIdentity> {
    let relative_path = to_relative_path(root, path).ok()?;
    let file_name = path.file_name()?.to_str()?.to_string();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    Some(NoteIdentity {
        relative_path,
        file_name,
        extension,
        modified_ms: modified_ms(metadata.modified()),
        size: metadata.len(),
    })
}

pub(crate) fn modified_ms(modified: io::Result<SystemTime>) -> u128 {
    modified
        .ok()
        .and_then(|value| value.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn validate_optional_directory(folder: Option<&str>) -> AppResult<Option<PathBuf>> {
    let Some(folder) = folder else {
        return Ok(None);
    };
    let normalized = folder.trim().trim_matches('/').trim_matches('\\');
    if normalized.is_empty() {
        return Ok(None);
    }
    validate_relative_path(normalized).map(Some)
}

pub fn slugify(title: &str) -> String {
    let mut slug = String::new();
    let mut last_dash = false;
    for character in title.trim().chars() {
        if character.is_alphanumeric() {
            slug.extend(character.to_lowercase());
            last_dash = false;
        } else if (character.is_whitespace() || "-_.".contains(character))
            && !last_dash
            && !slug.is_empty()
        {
            slug.push('-');
            last_dash = true;
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "untitled".into()
    } else {
        slug.into()
    }
}

fn yaml_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn yaml_tags(tags: Option<&[String]>) -> String {
    let tags = tags
        .unwrap_or_default()
        .iter()
        .map(|tag| tag.trim())
        .filter(|tag| !tag.is_empty())
        .map(yaml_quote)
        .collect::<Vec<_>>();
    if tags.is_empty() {
        "[]".into()
    } else {
        format!("[{}]", tags.join(", "))
    }
}

fn validate_export_path(path: &str) -> AppResult<PathBuf> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid_path("Export path is empty."));
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err(AppError::invalid_path("Export path must be absolute."));
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(AppError::invalid_path("Export path is invalid."));
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if extension != "pdf" {
        return Err(AppError::new(
            crate::domain::ErrorCode::UnsupportedExtension,
            "Only PDF export is supported.",
        ));
    }
    Ok(path)
}

fn unique_trash_path(trash: &Path, timestamp: u64, file_name: &str) -> PathBuf {
    for index in 0..1000 {
        let suffix = if index == 0 {
            String::new()
        } else {
            format!("-{index}")
        };
        let target = trash.join(format!("{timestamp}{suffix}-{file_name}"));
        if !target.exists() {
            return target;
        }
    }
    trash.join(format!("{timestamp}-overflow-{file_name}"))
}
