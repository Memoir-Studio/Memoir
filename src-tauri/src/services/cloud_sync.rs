use crate::{
    domain::{
        cloud_sync::{
            action_as_transfer, now_ms, plan_file, sanitize_profile, snapshot_from_identities,
            validate_profile_for_connect, CloudSyncFileError, CloudSyncProbe, CloudSyncProfile,
            CloudSyncReport, CloudSyncRunResult, FileIdentity, SyncAction,
        },
        path::normalize_workspace_key,
        AppError, AppResult, ErrorCode,
    },
    infrastructure::{
        app_data::AppDataRepository,
        cloud::{provider_from_profile, CloudProvider},
        filesystem::LocalFileSystem,
    },
    services::AppStateService,
};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone)]
pub struct CloudSyncService {
    filesystem: LocalFileSystem,
    app_state: AppStateService,
    app_data: AppDataRepository,
}

impl CloudSyncService {
    pub fn new(
        filesystem: LocalFileSystem,
        app_state: AppStateService,
        app_data: AppDataRepository,
    ) -> Self {
        Self {
            filesystem,
            app_state,
            app_data,
        }
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
        let workspace_key =
            normalize_workspace_key(workspace_root).unwrap_or_else(|_| workspace_root.to_string());
        let local_files = self.filesystem.list_syncable_files(workspace_root)?;
        let remote_files = provider.list()?;
        let snapshot = self.app_data.load_sync_snapshot(&workspace_key)?;
        let local_map = index_files(local_files);
        let remote_map = index_files(remote_files);
        let mut paths = BTreeSet::new();
        paths.extend(local_map.keys().cloned());
        paths.extend(remote_map.keys().cloned());
        paths.extend(snapshot.files.keys().cloned());

        let mut report = CloudSyncReport::default();
        let mut next_snapshot = snapshot.clone();

        for path in paths {
            let local = local_map.get(&path);
            let remote = remote_map.get(&path);
            let snap = snapshot.files.get(&path);
            let planned = plan_file(local, remote, snap);
            if matches!(planned, SyncAction::Conflict(_)) {
                report.conflicts += 1;
            }
            let action = action_as_transfer(planned);
            match self.apply_action(workspace_root, provider, &path, action, local, remote) {
                Ok(ApplyResult::Skipped) => report.skipped += 1,
                Ok(ApplyResult::Uploaded(entry)) => {
                    report.uploaded += 1;
                    next_snapshot.files.insert(path, entry);
                }
                Ok(ApplyResult::Downloaded(entry)) => {
                    report.downloaded += 1;
                    next_snapshot.files.insert(path, entry);
                }
                Ok(ApplyResult::DeletedRemote) => {
                    report.deleted_remote += 1;
                    next_snapshot.files.remove(&path);
                }
                Ok(ApplyResult::DeletedLocal) => {
                    report.deleted_local += 1;
                    next_snapshot.files.remove(&path);
                }
                Err(error) => {
                    report.errors.push(CloudSyncFileError {
                        path,
                        message: error.message,
                    });
                }
            }
        }

        report.completed_ms = now_ms();
        self.app_data
            .save_sync_snapshot(&workspace_key, &next_snapshot)?;
        Ok(report)
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
                    .or_else(|_| local.cloned().ok_or_else(|| AppError::not_found("Local file disappeared during upload.")))?;
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

    fn setup() -> (tempfile::TempDir, CloudSyncService, String) {
        let dir = tempdir().unwrap();
        let workspace = dir.path().join("notes");
        fs::create_dir(&workspace).unwrap();
        let app_data = AppDataRepository::new(dir.path().join("app-data"));
        let service = CloudSyncService::new(
            LocalFileSystem::new(),
            AppStateService::new(app_data.clone()),
            app_data,
        );
        (dir, service, workspace.to_string_lossy().into())
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
