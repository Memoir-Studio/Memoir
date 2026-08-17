use crate::domain::{
    attachment::{is_attachment_relative, validate_attachment_extension},
    path::{is_supported_note, validate_relative_path, IGNORED_DIRS},
    AppError, AppResult,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path};
use std::time::{SystemTime, UNIX_EPOCH};

pub const CLOUD_SYNC_SNAPSHOT_VERSION: u32 = 1;
pub const WEBDAV_PROVIDER_ID: &str = "webdav";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WebDavSettings {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub insecure_tls: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncFileError {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncReport {
    #[serde(default)]
    pub uploaded: u64,
    #[serde(default)]
    pub downloaded: u64,
    #[serde(default)]
    pub deleted_remote: u64,
    #[serde(default)]
    pub deleted_local: u64,
    #[serde(default)]
    pub skipped: u64,
    #[serde(default)]
    pub conflicts: u64,
    #[serde(default)]
    pub errors: Vec<CloudSyncFileError>,
    #[serde(default)]
    pub completed_ms: u64,
    #[serde(default)]
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub changed_local_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncProfile {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_provider")]
    pub provider: String,
    #[serde(default)]
    pub remote_prefix: String,
    #[serde(default)]
    pub webdav: WebDavSettings,
    #[serde(default)]
    pub last_sync_ms: Option<u64>,
    #[serde(default)]
    pub last_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_report: Option<CloudSyncReport>,
}

fn default_provider() -> String {
    WEBDAV_PROVIDER_ID.into()
}

impl Default for CloudSyncProfile {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: default_provider(),
            remote_prefix: String::new(),
            webdav: WebDavSettings::default(),
            last_sync_ms: None,
            last_status: Some("idle".into()),
            last_error: None,
            last_report: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncProbe {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CloudSyncRunResult {
    pub profile: CloudSyncProfile,
    pub report: CloudSyncReport,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileIdentity {
    pub relative_path: String,
    pub size: u64,
    pub modified_ms: u128,
    pub etag: Option<String>,
    pub hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LocalDirCacheEntry {
    pub modified_ms: i64,
    pub size: i64,
    pub entry_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncSnapshot {
    #[serde(default = "default_snapshot_version")]
    pub version: u32,
    #[serde(default)]
    pub files: BTreeMap<String, SnapshotEntry>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub local_dirs: BTreeMap<String, LocalDirCacheEntry>,
}

fn default_snapshot_version() -> u32 {
    CLOUD_SYNC_SNAPSHOT_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotEntry {
    pub local_size: u64,
    pub local_modified_ms: u128,
    pub remote_size: u64,
    pub remote_modified_ms: u128,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_etag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_hash: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictWinner {
    Local,
    Remote,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncAction {
    Upload,
    Download,
    DeleteRemote,
    DeleteLocal,
    Skip,
    Conflict(ConflictWinner),
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub fn sanitize_remote_prefix(value: &str) -> AppResult<String> {
    let trimmed = value.trim().trim_matches('/').trim_matches('\\');
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    validate_relative_path(trimmed)?;
    Ok(trimmed.replace('\\', "/"))
}

pub fn sanitize_profile(profile: CloudSyncProfile) -> AppResult<CloudSyncProfile> {
    let provider = profile.provider.trim().to_ascii_lowercase();
    if provider != WEBDAV_PROVIDER_ID {
        return Err(AppError::new(
            crate::domain::ErrorCode::Io,
            format!("Unsupported cloud provider: {}.", profile.provider),
        ));
    }
    let last_status = match profile.last_status.as_deref() {
        Some("ok") => Some("ok".into()),
        Some("error") => Some("error".into()),
        Some("idle") | None => Some("idle".into()),
        Some(_) => Some("idle".into()),
    };
    Ok(CloudSyncProfile {
        enabled: profile.enabled,
        provider,
        remote_prefix: sanitize_remote_prefix(&profile.remote_prefix)?,
        webdav: WebDavSettings {
            url: profile.webdav.url.trim().to_string(),
            username: profile.webdav.username.trim().to_string(),
            password: profile.webdav.password,
            insecure_tls: profile.webdav.insecure_tls,
        },
        last_sync_ms: profile.last_sync_ms,
        last_status,
        last_error: profile
            .last_error
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        last_report: profile.last_report,
    })
}

pub fn validate_profile_for_connect(profile: &CloudSyncProfile) -> AppResult<()> {
    if profile.provider != WEBDAV_PROVIDER_ID {
        return Err(AppError::new(
            crate::domain::ErrorCode::Io,
            format!("Unsupported cloud provider: {}.", profile.provider),
        ));
    }
    if profile.webdav.url.trim().is_empty() {
        return Err(AppError::invalid_path("WebDAV URL is required."));
    }
    Ok(())
}

pub fn is_conflict_sidecar(relative_path: &str) -> bool {
    Path::new(relative_path)
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.contains(".conflict-"))
}

pub fn conflict_sidecar_path(relative_path: &str, stamp_ms: u64) -> String {
    let path = Path::new(relative_path);
    let parent = path
        .parent()
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .filter(|value| !value.is_empty())
        .unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let name = match path.extension().and_then(|value| value.to_str()) {
        Some(extension) if !extension.is_empty() => {
            format!("{stem}.conflict-{stamp_ms}.{extension}")
        }
        _ => format!("{stem}.conflict-{stamp_ms}"),
    };
    if parent.is_empty() {
        name
    } else {
        format!("{parent}/{name}")
    }
}

pub fn is_writable_sync_path(relative_path: &str) -> bool {
    if is_conflict_sidecar(relative_path) {
        let Ok(path) = validate_relative_path(relative_path) else {
            return false;
        };
        return (is_attachment_relative(&path) && validate_attachment_extension(&path).is_ok())
            || is_supported_note(&path);
    }
    is_syncable_relative(relative_path)
}

pub fn is_syncable_relative(relative_path: &str) -> bool {
    if is_conflict_sidecar(relative_path) {
        return false;
    }
    let Ok(path) = validate_relative_path(relative_path) else {
        return false;
    };
    let mut components = path.components();
    let Some(Component::Normal(first)) = components.next() else {
        return false;
    };
    if crate::domain::attachment::is_attachment_root_name(first) {
        return is_attachment_relative(&path) && validate_attachment_extension(&path).is_ok();
    }
    if is_hidden_or_ignored(first) {
        return false;
    }
    for component in components {
        let Component::Normal(name) = component else {
            return false;
        };
        if is_hidden_or_ignored(name) {
            return false;
        }
    }
    is_supported_note(&path)
}

fn is_hidden_or_ignored(name: &std::ffi::OsStr) -> bool {
    name.to_str()
        .map(|value| value.starts_with('.') || IGNORED_DIRS.contains(&value))
        .unwrap_or(true)
}

pub fn merge_local_dir_cache(
    previous: &BTreeMap<String, LocalDirCacheEntry>,
    walked: &[(String, LocalDirCacheEntry)],
    reused: &[String],
) -> BTreeMap<String, LocalDirCacheEntry> {
    let mut keep: BTreeSet<String> = walked.iter().map(|(name, _)| name.clone()).collect();
    for dir in reused {
        keep.insert(dir.clone());
        for name in previous.keys() {
            if dir.is_empty() || name == dir || name.starts_with(&format!("{dir}/")) {
                keep.insert(name.clone());
            }
        }
    }
    let walked_map: BTreeMap<_, _> = walked.iter().cloned().collect();
    let mut next = BTreeMap::new();
    for name in keep {
        if let Some(entry) = walked_map.get(&name) {
            next.insert(name, entry.clone());
        } else if let Some(entry) = previous.get(&name) {
            next.insert(name, entry.clone());
        }
    }
    next
}

pub fn snapshot_from_identities(local: &FileIdentity, remote: &FileIdentity) -> SnapshotEntry {
    SnapshotEntry {
        local_size: local.size,
        local_modified_ms: local.modified_ms,
        remote_size: remote.size,
        remote_modified_ms: remote.modified_ms,
        remote_etag: remote.etag.clone(),
        local_hash: local.hash.clone().or_else(|| remote.hash.clone()),
    }
}

fn local_changed(local: &FileIdentity, snap: &SnapshotEntry) -> bool {
    if local.size == snap.local_size && local.modified_ms == snap.local_modified_ms {
        return false;
    }
    match (&local.hash, &snap.local_hash) {
        (Some(current), Some(previous)) => current != previous,
        _ => true,
    }
}

fn remote_changed(remote: &FileIdentity, snap: &SnapshotEntry) -> bool {
    match (&remote.etag, &snap.remote_etag) {
        (Some(current), Some(previous)) if !current.is_empty() && !previous.is_empty() => {
            current != previous
        }
        _ => remote.size != snap.remote_size || remote.modified_ms != snap.remote_modified_ms,
    }
}

fn same_content(local: &FileIdentity, remote: &FileIdentity) -> bool {
    if let (Some(local_hash), Some(remote_hash)) = (&local.hash, &remote.hash) {
        return local_hash == remote_hash;
    }
    local.size == remote.size
        && (local.modified_ms == remote.modified_ms
            || remote.etag.as_deref().is_some_and(|etag| !etag.is_empty()))
}

fn last_write_wins(local: &FileIdentity, remote: &FileIdentity) -> ConflictWinner {
    if local.modified_ms >= remote.modified_ms {
        ConflictWinner::Local
    } else {
        ConflictWinner::Remote
    }
}

pub fn plan_file(
    local: Option<&FileIdentity>,
    remote: Option<&FileIdentity>,
    snap: Option<&SnapshotEntry>,
) -> SyncAction {
    match (local, remote, snap) {
        (Some(_local), Some(_remote), Some(snap)) => {
            let local_dirty = local_changed(_local, snap);
            let remote_dirty = remote_changed(_remote, snap);
            match (local_dirty, remote_dirty) {
                (false, false) => SyncAction::Skip,
                (true, false) => SyncAction::Upload,
                (false, true) => SyncAction::Download,
                (true, true) => SyncAction::Conflict(last_write_wins(_local, _remote)),
            }
        }
        (Some(local), Some(remote), None) => {
            if local.size == remote.size && local.modified_ms == remote.modified_ms {
                SyncAction::Skip
            } else if same_content(local, remote) && local.modified_ms == remote.modified_ms {
                SyncAction::Skip
            } else {
                SyncAction::Conflict(last_write_wins(local, remote))
            }
        }
        (Some(_), None, Some(_)) => SyncAction::DeleteLocal,
        (Some(_), None, None) => SyncAction::Upload,
        (None, Some(_), Some(_)) => SyncAction::DeleteRemote,
        (None, Some(_), None) => SyncAction::Download,
        (None, None, _) => SyncAction::Skip,
    }
}

pub fn action_as_transfer(action: SyncAction) -> SyncAction {
    match action {
        SyncAction::Conflict(ConflictWinner::Local) => SyncAction::Upload,
        SyncAction::Conflict(ConflictWinner::Remote) => SyncAction::Download,
        other => other,
    }
}

pub fn is_note_relative(relative_path: &str) -> bool {
    is_supported_note(Path::new(relative_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, size: u64, modified_ms: u128) -> FileIdentity {
        FileIdentity {
            relative_path: path.into(),
            size,
            modified_ms,
            etag: None,
            hash: None,
        }
    }

    fn snap(local: &FileIdentity, remote: &FileIdentity) -> SnapshotEntry {
        snapshot_from_identities(local, remote)
    }

    #[test]
    fn classifies_syncable_workspace_paths() {
        assert!(is_syncable_relative("inbox.md"));
        assert!(is_syncable_relative("日记/today.mdx"));
        assert!(is_syncable_relative("attachments/2026-08/photo.png"));
        assert!(is_syncable_relative("attachments/legacy.jpg"));
        assert!(!is_syncable_relative("attachments/photo.conflict-1.png"));
        assert!(!is_syncable_relative("../escape.md"));
        assert!(!is_syncable_relative(".memoir/index.sqlite"));
        assert!(!is_syncable_relative(".memoir-trash/note.md"));
        assert!(!is_syncable_relative("node_modules/pkg/readme.md"));
        assert!(!is_syncable_relative(
            ".memoir-attachments/2026-08/photo.png"
        ));
        assert!(!is_syncable_relative("notes.txt"));
        assert_eq!(
            conflict_sidecar_path("attachments/2026-08/photo.png", 42),
            "attachments/2026-08/photo.conflict-42.png"
        );
        assert!(is_writable_sync_path(
            "attachments/2026-08/photo.conflict-42.png"
        ));
    }

    #[test]
    fn plans_first_sync_and_snapshot_follow_up() {
        let local = file("a.md", 10, 20);
        let remote = file("a.md", 10, 20);
        assert_eq!(
            plan_file(Some(&local), Some(&remote), None),
            SyncAction::Skip
        );
        assert_eq!(plan_file(Some(&local), None, None), SyncAction::Upload);
        assert_eq!(plan_file(None, Some(&remote), None), SyncAction::Download);

        let older_remote = file("a.md", 8, 5);
        assert_eq!(
            plan_file(Some(&local), Some(&older_remote), None),
            SyncAction::Conflict(ConflictWinner::Local)
        );

        let snapshot = snap(&local, &remote);
        let local_new = file("a.md", 12, 40);
        let remote_new = file("a.md", 9, 50);
        assert_eq!(
            plan_file(Some(&local_new), Some(&remote), Some(&snapshot)),
            SyncAction::Upload
        );
        assert_eq!(
            plan_file(Some(&local), Some(&remote_new), Some(&snapshot)),
            SyncAction::Download
        );
        assert_eq!(
            plan_file(Some(&local_new), Some(&remote_new), Some(&snapshot)),
            SyncAction::Conflict(ConflictWinner::Remote)
        );
        assert_eq!(
            plan_file(Some(&local), None, Some(&snapshot)),
            SyncAction::DeleteLocal
        );
        assert_eq!(
            plan_file(None, Some(&remote), Some(&snapshot)),
            SyncAction::DeleteRemote
        );
    }

    #[test]
    fn matching_hashes_skip_a_touched_local_file() {
        let local = FileIdentity {
            relative_path: "a.md".into(),
            size: 12,
            modified_ms: 80,
            etag: None,
            hash: Some("abc".into()),
        };
        let remote = file("a.md", 10, 20);
        let mut snapshot = snap(&file("a.md", 10, 20), &remote);
        snapshot.local_hash = Some("abc".into());
        assert_eq!(
            plan_file(Some(&local), Some(&remote), Some(&snapshot)),
            SyncAction::Skip
        );
        let different = FileIdentity {
            hash: Some("def".into()),
            ..local
        };
        assert_eq!(
            plan_file(Some(&different), Some(&remote), Some(&snapshot)),
            SyncAction::Upload
        );
    }

    #[test]
    fn remote_etag_beats_mtime_when_present() {
        let local = file("a.md", 10, 20);
        let mut remote = file("a.md", 10, 99);
        remote.etag = Some("\"one\"".into());
        let mut snapshot = snap(&local, &remote);
        snapshot.remote_etag = Some("\"one\"".into());
        assert_eq!(
            plan_file(Some(&local), Some(&remote), Some(&snapshot)),
            SyncAction::Skip
        );
        remote.etag = Some("\"two\"".into());
        assert_eq!(
            plan_file(Some(&local), Some(&remote), Some(&snapshot)),
            SyncAction::Download
        );
    }

    #[test]
    fn merges_attachment_dir_cache_rows() {
        let mut previous = BTreeMap::new();
        previous.insert(
            "attachments".into(),
            LocalDirCacheEntry {
                modified_ms: 1,
                size: 2,
                entry_count: 1,
            },
        );
        previous.insert(
            "attachments/2026-08".into(),
            LocalDirCacheEntry {
                modified_ms: 3,
                size: 4,
                entry_count: 2,
            },
        );
        let walked = [(
            "attachments/2026-09".into(),
            LocalDirCacheEntry {
                modified_ms: 5,
                size: 6,
                entry_count: 1,
            },
        )];
        let merged = merge_local_dir_cache(&previous, &walked, &["attachments".into()]);
        assert_eq!(merged["attachments"].modified_ms, 1);
        assert_eq!(merged["attachments/2026-08"].entry_count, 2);
        assert_eq!(merged["attachments/2026-09"].modified_ms, 5);
    }

    #[test]
    fn sanitizes_prefix_and_rejects_unknown_providers() {
        assert_eq!(
            sanitize_remote_prefix(" /Memoir/notes/ ").unwrap(),
            "Memoir/notes"
        );
        assert!(sanitize_remote_prefix("../outside").is_err());
        let err = sanitize_profile(CloudSyncProfile {
            provider: "s3".into(),
            ..CloudSyncProfile::default()
        })
        .unwrap_err();
        assert!(err.message.contains("Unsupported cloud provider"));
    }
}
