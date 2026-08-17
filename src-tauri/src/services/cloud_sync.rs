use crate::{
    domain::{
        attachment::is_attachment_relative,
        cloud_sync::{
            action_as_transfer, conflict_sidecar_path, is_conflict_sidecar, merge_local_dir_cache,
            now_ms, plan_file, sanitize_profile, snapshot_from_identities,
            validate_profile_for_connect, CloudSyncFileError, CloudSyncProbe, CloudSyncProfile,
            CloudSyncReport, CloudSyncRunResult, FileIdentity, LocalDirCacheEntry, SyncAction,
            SyncSnapshot,
        },
        path::normalize_workspace_key,
        AppError, AppResult, ErrorCode,
    },
    infrastructure::{
        app_data::AppDataRepository,
        cloud::{provider_from_profile, CloudProvider},
        filesystem::LocalFileSystem,
        index::DirCacheRow,
    },
    services::{AppStateService, WorkspaceService},
};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::thread;

const TRANSFER_PARALLELISM: usize = 4;

#[derive(Debug, Clone)]
pub struct CloudSyncService {
    filesystem: LocalFileSystem,
    app_state: AppStateService,
    app_data: AppDataRepository,
    workspace: WorkspaceService,
}

impl CloudSyncService {
    pub fn new(
        filesystem: LocalFileSystem,
        app_state: AppStateService,
        app_data: AppDataRepository,
        workspace: WorkspaceService,
    ) -> Self {
        Self {
            filesystem,
            app_state,
            app_data,
            workspace,
        }
    }

    #[cfg(test)]
    fn test_workspace(&self) -> &WorkspaceService {
        &self.workspace
    }

    #[cfg(test)]
    fn test_filesystem(&self) -> &LocalFileSystem {
        &self.filesystem
    }

    pub fn profile(&self, workspace_root: &str) -> AppResult<CloudSyncProfile> {
        self.app_state.cloud_sync_profile(workspace_root)
    }

    pub fn save_profile(
        &self,
        workspace_root: &str,
        profile: CloudSyncProfile,
    ) -> AppResult<CloudSyncProfile> {
        self.app_state
            .save_cloud_sync_profile(workspace_root.to_string(), profile)
    }

    pub fn test_connection(&self, profile: CloudSyncProfile) -> AppResult<CloudSyncProbe> {
        let profile = sanitize_profile(profile)?;
        validate_profile_for_connect(&profile)?;
        let provider = provider_from_profile(&profile)?;
        provider.probe()?;
        Ok(CloudSyncProbe {
            ok: true,
            message: "Connected.".into(),
        })
    }

    pub fn run_sync(
        &self,
        workspace_root: &str,
        profile: Option<CloudSyncProfile>,
    ) -> AppResult<CloudSyncRunResult> {
        let workspace_key =
            normalize_workspace_key(workspace_root).unwrap_or_else(|_| workspace_root.to_string());
        let mut profile = match profile {
            Some(incoming) => self.save_profile(&workspace_key, incoming)?,
            None => sanitize_profile(self.profile(&workspace_key)?)?,
        };
        if !profile.enabled {
            return Err(AppError::new(
                ErrorCode::Io,
                "Enable cloud sync before running it.",
            ));
        }
        validate_profile_for_connect(&profile)?;
        let provider = provider_from_profile(&profile)?;
        match self.run_sync_with(workspace_root, provider.as_ref()) {
            Ok(report) => {
                profile.last_sync_ms = Some(report.completed_ms);
                profile.last_status = Some("ok".into());
                profile.last_error = None;
                profile.last_report = Some(report.clone());
                let profile = self.save_profile(&workspace_key, profile)?;
                Ok(CloudSyncRunResult { profile, report })
            }
            Err(error) => {
                profile.last_sync_ms = Some(now_ms());
                profile.last_status = Some("error".into());
                profile.last_error = Some(error.message.clone());
                let _ = self.save_profile(&workspace_key, profile);
                Err(error)
            }
        }
    }

    pub fn run_sync_with(
        &self,
        workspace_root: &str,
        provider: &dyn CloudProvider,
    ) -> AppResult<CloudSyncReport> {
        let started_ms = now_ms();
        let workspace_key =
            normalize_workspace_key(workspace_root).unwrap_or_else(|_| workspace_root.to_string());
        let snapshot = self.app_data.load_sync_snapshot(&workspace_key)?;
        let (local_files, attachment_walk) = self.list_local_files(workspace_root, &snapshot)?;
        let remote_files = provider.list()?;
        let local_map = index_files(local_files);
        let remote_map = index_files(remote_files);
        let mut paths = BTreeSet::new();
        paths.extend(local_map.keys().cloned());
        paths.extend(remote_map.keys().cloned());
        paths.extend(snapshot.files.keys().cloned());
        let mut ordered: Vec<String> = paths.into_iter().collect();
        ordered.sort_by(|left, right| {
            sync_rank(left)
                .cmp(&sync_rank(right))
                .then_with(|| left.cmp(right))
        });

        let mut report = CloudSyncReport::default();
        let mut next_snapshot = snapshot.clone();
        let mut hashed_locals: HashMap<String, FileIdentity> = HashMap::new();
        let mut transfers: Vec<TransferJob> = Vec::new();

        for path in ordered {
            if is_conflict_sidecar(&path) {
                continue;
            }
            let remote = remote_map.get(&path);
            let snap = snapshot.files.get(&path);
            if let Some(hashed) =
                enrich_local_hash(workspace_root, &self.filesystem, local_map.get(&path), snap)
            {
                hashed_locals.insert(path.clone(), hashed);
            }
            let local = hashed_locals.get(&path).or_else(|| local_map.get(&path));
            let planned = plan_file(local, remote, snap);
            if matches!(planned, SyncAction::Conflict(_)) {
                report.conflicts += 1;
                if let Ok(Some(sidecar)) =
                    self.keep_conflict_copy(workspace_root, provider, &path, planned, local, remote)
                {
                    report.changed_local_paths.push(sidecar);
                    report.changed_local_paths.push(path.clone());
                }
            }
            let action = action_as_transfer(planned);
            match action {
                SyncAction::Skip | SyncAction::Conflict(_) => report.skipped += 1,
                SyncAction::Upload | SyncAction::Download => transfers.push(TransferJob {
                    path,
                    action,
                    local: local.cloned(),
                    remote: remote.cloned(),
                }),
                SyncAction::DeleteRemote | SyncAction::DeleteLocal => {
                    match self.apply_action(workspace_root, provider, &path, action, local, remote)
                    {
                        Ok(ApplyResult::DeletedRemote) => {
                            report.deleted_remote += 1;
                            next_snapshot.files.remove(&path);
                        }
                        Ok(ApplyResult::DeletedLocal) => {
                            report.deleted_local += 1;
                            next_snapshot.files.remove(&path);
                            report.changed_local_paths.push(path);
                        }
                        Ok(ApplyResult::Skipped) => report.skipped += 1,
                        Ok(ApplyResult::Uploaded(entry)) => {
                            report.uploaded += 1;
                            next_snapshot.files.insert(path, entry);
                        }
                        Ok(ApplyResult::Downloaded(entry)) => {
                            report.downloaded += 1;
                            next_snapshot.files.insert(path.clone(), entry);
                            report.changed_local_paths.push(path);
                        }
                        Err(error) => {
                            report.errors.push(CloudSyncFileError {
                                path,
                                message: error.message,
                            });
                        }
                    }
                }
            }
        }

        self.apply_transfers(
            workspace_root,
            provider,
            transfers,
            &mut report,
            &mut next_snapshot,
        )?;

        next_snapshot.local_dirs = merge_local_dir_cache(
            &snapshot.local_dirs,
            &attachment_walk
                .walked_dirs
                .into_iter()
                .map(|row| (row.relative_dir.clone(), dir_entry_from_row(&row)))
                .collect::<Vec<_>>(),
            &attachment_walk.reused_dirs,
        );
        report.completed_ms = now_ms();
        report.duration_ms = report.completed_ms.saturating_sub(started_ms);
        if next_snapshot != snapshot {
            self.app_data
                .save_sync_snapshot(&workspace_key, &next_snapshot)?;
        }
        Ok(report)
    }

    fn list_local_files(
        &self,
        workspace_root: &str,
        snapshot: &SyncSnapshot,
    ) -> AppResult<(
        Vec<FileIdentity>,
        crate::infrastructure::filesystem::AttachmentWalk,
    )> {
        let mut files = self.workspace.list_sync_notes(workspace_root)?;
        let cache = dir_cache_from_snapshot(snapshot);
        let known = snapshot
            .files
            .keys()
            .filter(|path| is_attachment_relative(Path::new(path)) && !is_conflict_sidecar(path))
            .cloned()
            .collect::<Vec<_>>();
        let walk = self
            .filesystem
            .scan_attachments_cached(workspace_root, &cache, &known)?;
        files.extend(walk.files.iter().cloned());
        Ok((files, walk))
    }

    fn apply_transfers(
        &self,
        workspace_root: &str,
        provider: &dyn CloudProvider,
        jobs: Vec<TransferJob>,
        report: &mut CloudSyncReport,
        next_snapshot: &mut SyncSnapshot,
    ) -> AppResult<()> {
        if jobs.is_empty() {
            return Ok(());
        }
        let attachment_jobs = jobs
            .iter()
            .filter(|job| sync_rank(&job.path) == 0)
            .cloned()
            .collect::<Vec<_>>();
        let note_jobs = jobs
            .into_iter()
            .filter(|job| sync_rank(&job.path) == 1)
            .collect::<Vec<_>>();
        self.apply_transfer_rank(
            workspace_root,
            provider,
            attachment_jobs,
            report,
            next_snapshot,
        );
        self.apply_transfer_rank(workspace_root, provider, note_jobs, report, next_snapshot);
        Ok(())
    }

    fn apply_transfer_rank(
        &self,
        workspace_root: &str,
        provider: &dyn CloudProvider,
        jobs: Vec<TransferJob>,
        report: &mut CloudSyncReport,
        next_snapshot: &mut SyncSnapshot,
    ) {
        if jobs.is_empty() {
            return;
        }
        if jobs.len() == 1 {
            let job = &jobs[0];
            self.record_transfer(
                &job.path,
                self.apply_action(
                    workspace_root,
                    provider,
                    &job.path,
                    job.action,
                    job.local.as_ref(),
                    job.remote.as_ref(),
                ),
                report,
                next_snapshot,
            );
            return;
        }

        let workers = TRANSFER_PARALLELISM.min(jobs.len());
        let next_index = AtomicUsize::new(0);
        let outcomes = Mutex::new(Vec::new());
        thread::scope(|scope| {
            for _ in 0..workers {
                scope.spawn(|| loop {
                    let index = next_index.fetch_add(1, Ordering::Relaxed);
                    if index >= jobs.len() {
                        break;
                    }
                    let job = &jobs[index];
                    let result = self.apply_action(
                        workspace_root,
                        provider,
                        &job.path,
                        job.action,
                        job.local.as_ref(),
                        job.remote.as_ref(),
                    );
                    outcomes
                        .lock()
                        .expect("transfer outcomes")
                        .push((job.path.clone(), result));
                });
            }
        });
        for (path, result) in outcomes.into_inner().unwrap_or_default() {
            self.record_transfer(&path, result, report, next_snapshot);
        }
    }

    fn record_transfer(
        &self,
        path: &str,
        result: AppResult<ApplyResult>,
        report: &mut CloudSyncReport,
        next_snapshot: &mut SyncSnapshot,
    ) {
        match result {
            Ok(ApplyResult::Skipped) => report.skipped += 1,
            Ok(ApplyResult::Uploaded(entry)) => {
                report.uploaded += 1;
                next_snapshot.files.insert(path.to_string(), entry);
            }
            Ok(ApplyResult::Downloaded(entry)) => {
                report.downloaded += 1;
                next_snapshot.files.insert(path.to_string(), entry);
                report.changed_local_paths.push(path.to_string());
            }
            Ok(ApplyResult::DeletedRemote) => {
                report.deleted_remote += 1;
                next_snapshot.files.remove(path);
            }
            Ok(ApplyResult::DeletedLocal) => {
                report.deleted_local += 1;
                next_snapshot.files.remove(path);
                report.changed_local_paths.push(path.to_string());
            }
            Err(error) => {
                report.errors.push(CloudSyncFileError {
                    path: path.to_string(),
                    message: error.message,
                });
            }
        }
    }

    fn apply_action(
        &self,
        workspace_root: &str,
        provider: &dyn CloudProvider,
        path: &str,
        action: SyncAction,
        local: Option<&FileIdentity>,
        remote: Option<&FileIdentity>,
    ) -> AppResult<ApplyResult> {
        match action {
            SyncAction::Skip | SyncAction::Conflict(_) => Ok(ApplyResult::Skipped),
            SyncAction::Upload => {
                let bytes = self.filesystem.read_sync_file(workspace_root, path)?;
                let remote = provider.put(path, &bytes)?;
                let local = self
                    .filesystem
                    .stat_sync_file(workspace_root, path)
                    .or_else(|_| {
                        local.cloned().ok_or_else(|| {
                            AppError::not_found("Local file disappeared during upload.")
                        })
                    })?;
                Ok(ApplyResult::Uploaded(snapshot_from_identities(
                    &local, &remote,
                )))
            }
            SyncAction::Download => {
                let bytes = provider.get(path)?;
                let local = self
                    .filesystem
                    .write_sync_file(workspace_root, path, &bytes)?;
                let remote = remote.cloned().unwrap_or(FileIdentity {
                    relative_path: path.to_string(),
                    size: bytes.len() as u64,
                    modified_ms: local.modified_ms,
                    etag: None,
                    hash: local.hash.clone(),
                });
                Ok(ApplyResult::Downloaded(snapshot_from_identities(
                    &local, &remote,
                )))
            }
            SyncAction::DeleteRemote => {
                provider.delete(path)?;
                Ok(ApplyResult::DeletedRemote)
            }
            SyncAction::DeleteLocal => {
                self.filesystem.delete_sync_file(workspace_root, path)?;
                Ok(ApplyResult::DeletedLocal)
            }
        }
    }

    fn keep_conflict_copy(
        &self,
        workspace_root: &str,
        provider: &dyn CloudProvider,
        path: &str,
        planned: SyncAction,
        local: Option<&FileIdentity>,
        remote: Option<&FileIdentity>,
    ) -> AppResult<Option<String>> {
        if !is_attachment_relative(Path::new(path)) {
            return Ok(None);
        }
        let sidecar = unique_sidecar_path(workspace_root, &self.filesystem, path);
        match planned {
            SyncAction::Conflict(crate::domain::cloud_sync::ConflictWinner::Remote) => {
                if local.is_some() {
                    let bytes = self.filesystem.read_sync_file(workspace_root, path)?;
                    self.filesystem
                        .write_sync_file(workspace_root, &sidecar, &bytes)?;
                    return Ok(Some(sidecar));
                }
            }
            SyncAction::Conflict(crate::domain::cloud_sync::ConflictWinner::Local) => {
                if remote.is_some() {
                    let bytes = provider.get(path)?;
                    self.filesystem
                        .write_sync_file(workspace_root, &sidecar, &bytes)?;
                    return Ok(Some(sidecar));
                }
            }
            _ => {}
        }
        Ok(None)
    }
}

#[derive(Debug, Clone)]
struct TransferJob {
    path: String,
    action: SyncAction,
    local: Option<FileIdentity>,
    remote: Option<FileIdentity>,
}

enum ApplyResult {
    Skipped,
    Uploaded(crate::domain::cloud_sync::SnapshotEntry),
    Downloaded(crate::domain::cloud_sync::SnapshotEntry),
    DeletedRemote,
    DeletedLocal,
}

fn index_files(files: Vec<FileIdentity>) -> BTreeMap<String, FileIdentity> {
    files
        .into_iter()
        .map(|file| (file.relative_path.clone(), file))
        .collect()
}

fn sync_rank(path: &str) -> u8 {
    if is_attachment_relative(Path::new(path)) {
        0
    } else {
        1
    }
}

fn enrich_local_hash(
    workspace_root: &str,
    filesystem: &LocalFileSystem,
    local: Option<&FileIdentity>,
    snap: Option<&crate::domain::cloud_sync::SnapshotEntry>,
) -> Option<FileIdentity> {
    let local = local?;
    let snap = snap?;
    if local.size == snap.local_size && local.modified_ms == snap.local_modified_ms {
        return None;
    }
    if local.hash.is_some() || snap.local_hash.is_none() {
        return None;
    }
    let hash = filesystem
        .hash_sync_file(workspace_root, &local.relative_path)
        .ok()?;
    Some(FileIdentity {
        hash: Some(hash),
        ..local.clone()
    })
}

fn dir_entry_from_row(row: &DirCacheRow) -> LocalDirCacheEntry {
    LocalDirCacheEntry {
        modified_ms: row.modified_ms,
        size: row.size,
        entry_count: row.entry_count,
    }
}

fn dir_cache_from_snapshot(snapshot: &SyncSnapshot) -> HashMap<String, DirCacheRow> {
    snapshot
        .local_dirs
        .iter()
        .map(|(name, entry)| {
            (
                name.clone(),
                DirCacheRow {
                    relative_dir: name.clone(),
                    modified_ms: entry.modified_ms,
                    size: entry.size,
                    entry_count: entry.entry_count,
                },
            )
        })
        .collect()
}

fn unique_sidecar_path(workspace_root: &str, filesystem: &LocalFileSystem, path: &str) -> String {
    let base = conflict_sidecar_path(path, now_ms());
    if filesystem.stat_sync_file(workspace_root, &base).is_err() {
        return base;
    }
    for index in 1..20 {
        let candidate = conflict_sidecar_path(path, now_ms() + index as u64);
        if filesystem
            .stat_sync_file(workspace_root, &candidate)
            .is_err()
        {
            return candidate;
        }
    }
    base
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::cloud_sync::WEBDAV_PROVIDER_ID;
    use std::fs;
    use std::sync::Mutex;
    use tempfile::tempdir;

    struct MemoryProvider {
        files: Mutex<BTreeMap<String, (Vec<u8>, FileIdentity)>>,
    }

    impl MemoryProvider {
        fn new() -> Self {
            Self {
                files: Mutex::new(BTreeMap::new()),
            }
        }

        fn insert(&self, path: &str, bytes: &[u8], modified_ms: u128) {
            self.files.lock().unwrap().insert(
                path.into(),
                (
                    bytes.to_vec(),
                    FileIdentity {
                        relative_path: path.into(),
                        size: bytes.len() as u64,
                        modified_ms,
                        etag: Some(format!("\"{modified_ms}\"")),
                        hash: None,
                    },
                ),
            );
        }
    }

    impl CloudProvider for MemoryProvider {
        fn id(&self) -> &'static str {
            "memory"
        }

        fn probe(&self) -> AppResult<()> {
            Ok(())
        }

        fn list(&self) -> AppResult<Vec<FileIdentity>> {
            Ok(self
                .files
                .lock()
                .unwrap()
                .values()
                .map(|(_, identity)| identity.clone())
                .collect())
        }

        fn get(&self, relative_path: &str) -> AppResult<Vec<u8>> {
            self.files
                .lock()
                .unwrap()
                .get(relative_path)
                .map(|(bytes, _)| bytes.clone())
                .ok_or_else(|| AppError::not_found("Remote file does not exist."))
        }

        fn put(&self, relative_path: &str, bytes: &[u8]) -> AppResult<FileIdentity> {
            let identity = FileIdentity {
                relative_path: relative_path.into(),
                size: bytes.len() as u64,
                modified_ms: 9_000,
                etag: Some("\"9000\"".into()),
                hash: None,
            };
            self.files
                .lock()
                .unwrap()
                .insert(relative_path.into(), (bytes.to_vec(), identity.clone()));
            Ok(identity)
        }

        fn delete(&self, relative_path: &str) -> AppResult<()> {
            self.files.lock().unwrap().remove(relative_path);
            Ok(())
        }
    }

    struct CountingProvider {
        inner: MemoryProvider,
        current: std::sync::atomic::AtomicUsize,
        max: std::sync::atomic::AtomicUsize,
    }

    impl CountingProvider {
        fn new() -> Self {
            Self {
                inner: MemoryProvider::new(),
                current: std::sync::atomic::AtomicUsize::new(0),
                max: std::sync::atomic::AtomicUsize::new(0),
            }
        }

        fn max_in_flight(&self) -> usize {
            self.max.load(std::sync::atomic::Ordering::Relaxed)
        }
    }

    impl CloudProvider for CountingProvider {
        fn id(&self) -> &'static str {
            "counting"
        }

        fn probe(&self) -> AppResult<()> {
            Ok(())
        }

        fn list(&self) -> AppResult<Vec<FileIdentity>> {
            self.inner.list()
        }

        fn get(&self, relative_path: &str) -> AppResult<Vec<u8>> {
            self.inner.get(relative_path)
        }

        fn put(&self, relative_path: &str, bytes: &[u8]) -> AppResult<FileIdentity> {
            let now = self
                .current
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                + 1;
            self.max.fetch_max(now, std::sync::atomic::Ordering::SeqCst);
            std::thread::sleep(std::time::Duration::from_millis(40));
            let result = self.inner.put(relative_path, bytes);
            self.current
                .fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
            result
        }

        fn delete(&self, relative_path: &str) -> AppResult<()> {
            self.inner.delete(relative_path)
        }
    }

    fn snapshot_path(root: &std::path::Path) -> std::path::PathBuf {
        let sync = root.join("app-data/sync");
        for entry in std::fs::read_dir(&sync).unwrap() {
            let path = entry.unwrap().path().join("snapshot.json");
            if path.exists() {
                return path;
            }
        }
        panic!("sync snapshot was not written");
    }

    fn setup() -> (tempfile::TempDir, CloudSyncService, String) {
        let dir = tempdir().unwrap();
        let notes = dir.path().join("notes");
        fs::create_dir(&notes).unwrap();
        let app_data = AppDataRepository::new(dir.path().join("app-data"));
        let filesystem = LocalFileSystem::new();
        let workspace = WorkspaceService::new(filesystem.clone());
        let service = CloudSyncService::new(
            filesystem,
            AppStateService::new(app_data.clone()),
            app_data,
            workspace,
        );
        (dir, service, notes.to_string_lossy().into())
    }

    #[test]
    fn uploads_new_local_notes_and_downloads_new_remote_notes() {
        let (_dir, service, root) = setup();
        fs::write(std::path::Path::new(&root).join("local.md"), "# Local").unwrap();
        let provider = MemoryProvider::new();
        provider.insert("remote.md", b"# Remote", 50);

        let report = service.run_sync_with(&root, &provider).unwrap();
        assert_eq!(report.uploaded, 1);
        assert_eq!(report.downloaded, 1);
        assert_eq!(
            fs::read_to_string(std::path::Path::new(&root).join("remote.md")).unwrap(),
            "# Remote"
        );
        assert_eq!(
            String::from_utf8(provider.get("local.md").unwrap()).unwrap(),
            "# Local"
        );

        let second = service.run_sync_with(&root, &provider).unwrap();
        assert_eq!(second.uploaded, 0);
        assert_eq!(second.downloaded, 0);
        assert!(second.skipped >= 2);
    }

    #[test]
    fn downloads_a_newer_remote_copy_and_propagates_remote_deletes() {
        let (_dir, service, root) = setup();
        fs::write(std::path::Path::new(&root).join("shared.md"), "local-old").unwrap();
        let provider = MemoryProvider::new();
        service.run_sync_with(&root, &provider).unwrap();

        provider.insert("shared.md", b"remote-newer", 9_999_999_999_999);
        let report = service.run_sync_with(&root, &provider).unwrap();
        assert_eq!(report.downloaded, 1);
        assert_eq!(
            fs::read_to_string(std::path::Path::new(&root).join("shared.md")).unwrap(),
            "remote-newer"
        );

        provider.delete("shared.md").unwrap();
        let deleted = service.run_sync_with(&root, &provider).unwrap();
        assert_eq!(deleted.deleted_local, 1);
        assert!(!std::path::Path::new(&root).join("shared.md").exists());
    }

    #[test]
    fn keeps_a_local_copy_when_a_remote_attachment_wins() {
        let (_dir, service, root) = setup();
        let image = [0x89, b'P', b'N', b'G', 1, 2, 3, 4];
        let path = "attachments/2026-08/photo.png";
        std::fs::create_dir_all(std::path::Path::new(&root).join("attachments/2026-08")).unwrap();
        std::fs::write(std::path::Path::new(&root).join(path), image).unwrap();
        let provider = MemoryProvider::new();
        service.run_sync_with(&root, &provider).unwrap();

        std::fs::write(std::path::Path::new(&root).join(path), b"local-changed").unwrap();
        provider.insert(path, b"remote-newer-bytes!!", 9_999_999_999_999);
        let report = service.run_sync_with(&root, &provider).unwrap();
        assert_eq!(report.downloaded, 1);
        assert_eq!(report.conflicts, 1);
        let dir = std::path::Path::new(&root).join("attachments/2026-08");
        let backups: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name.contains(".conflict-"))
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(
            std::fs::read(std::path::Path::new(&root).join(path)).unwrap(),
            b"remote-newer-bytes!!"
        );
    }

    #[test]
    fn reuses_index_dir_cache_when_listing_notes_for_sync() {
        let (_dir, service, root) = setup();
        fs::create_dir_all(std::path::Path::new(&root).join("journal")).unwrap();
        fs::write(std::path::Path::new(&root).join("root.md"), "# Root").unwrap();
        fs::write(std::path::Path::new(&root).join("journal/day.md"), "# Day").unwrap();
        service
            .test_workspace()
            .reconcile(&root, &crate::domain::LibraryQuery::default())
            .unwrap();
        service
            .test_workspace()
            .walk_dirs
            .store(0, std::sync::atomic::Ordering::Relaxed);
        service
            .test_filesystem()
            .walk_dirs
            .store(0, std::sync::atomic::Ordering::Relaxed);

        let provider = MemoryProvider::new();
        let report = service.run_sync_with(&root, &provider).unwrap();
        assert_eq!(report.uploaded, 2);
        assert_eq!(
            service
                .test_workspace()
                .walk_dirs
                .load(std::sync::atomic::Ordering::Relaxed),
            0
        );
    }

    #[test]
    fn skips_rewriting_an_unchanged_snapshot() {
        let (dir, service, root) = setup();
        fs::write(std::path::Path::new(&root).join("keep.md"), "# Keep").unwrap();
        let provider = MemoryProvider::new();
        service.run_sync_with(&root, &provider).unwrap();
        let snapshot = snapshot_path(dir.path());
        let first = std::fs::metadata(&snapshot).unwrap().modified().unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let second = service.run_sync_with(&root, &provider).unwrap();
        assert!(second.skipped >= 1);
        assert_eq!(second.uploaded, 0);
        let after = std::fs::metadata(&snapshot).unwrap().modified().unwrap();
        assert_eq!(first, after);
    }

    #[test]
    fn uploads_independent_files_in_parallel() {
        let (_dir, service, root) = setup();
        fs::write(std::path::Path::new(&root).join("a.md"), "# A").unwrap();
        fs::write(std::path::Path::new(&root).join("b.md"), "# B").unwrap();
        let provider = CountingProvider::new();
        let report = service.run_sync_with(&root, &provider).unwrap();
        assert_eq!(report.uploaded, 2);
        assert!(
            provider.max_in_flight() >= 2,
            "expected overlapping uploads, max {}",
            provider.max_in_flight()
        );
    }

    #[test]
    fn persists_a_webdav_profile_per_workspace() {
        let (_dir, service, root) = setup();
        let saved = service
            .save_profile(
                &root,
                CloudSyncProfile {
                    enabled: true,
                    provider: WEBDAV_PROVIDER_ID.into(),
                    remote_prefix: "/Memoir/".into(),
                    webdav: crate::domain::cloud_sync::WebDavSettings {
                        url: " https://dav.example/dav ".into(),
                        username: " ada ".into(),
                        password: "secret".into(),
                        insecure_tls: true,
                    },
                    ..CloudSyncProfile::default()
                },
            )
            .unwrap();
        assert_eq!(saved.remote_prefix, "Memoir");
        assert_eq!(saved.webdav.url, "https://dav.example/dav");
        assert_eq!(saved.webdav.username, "ada");
        assert_eq!(service.profile(&root).unwrap().webdav.password, "secret");
    }
}
