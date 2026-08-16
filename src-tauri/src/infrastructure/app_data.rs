use crate::{
    domain::{
        cloud_sync::{SyncSnapshot, CLOUD_SYNC_SNAPSHOT_VERSION},
        AppError, AppResult, AppState, LegacyDraft, APP_STATE_VERSION,
    },
    infrastructure::atomic::atomic_write,
};
use sha2::{Digest, Sha256};
#[cfg(test)]
use std::path::Path;
use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
};

#[derive(Debug, Clone)]
pub struct AppDataRepository {
    root: PathBuf,
}

impl AppDataRepository {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    #[cfg(test)]
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn load_state(&self) -> AppResult<AppState> {
        let path = self.state_path();
        if !path.exists() {
            return Ok(AppState::default());
        }
        let bytes = fs::read(&path)
            .map_err(|error| AppError::io("Read application state", &path, error))?;
        let mut state: AppState =
            serde_json::from_slice(&bytes).map_err(AppError::serialization)?;
        if state.version > APP_STATE_VERSION {
            return Err(AppError::serialization(format!(
                "Unsupported app-state version {}.",
                state.version
            )));
        }
        state.version = APP_STATE_VERSION;
        Ok(state)
    }

    pub fn save_state(&self, state: &AppState) -> AppResult<()> {
        let mut state = state.clone();
        state.version = APP_STATE_VERSION;
        let bytes = serde_json::to_vec_pretty(&state).map_err(AppError::serialization)?;
        atomic_write(&self.state_path(), &bytes)
    }

    pub fn read_draft(
        &self,
        workspace_root: &str,
        relative_path: &str,
    ) -> AppResult<Option<String>> {
        let path = self.draft_path(workspace_root, relative_path);
        if path.exists() {
            return fs::read_to_string(&path)
                .map(Some)
                .map_err(|error| AppError::io("Read draft", &path, error));
        }
        let legacy_key = format!("memoir:draft:{workspace_root}:{relative_path}");
        let legacy_path = self.legacy_draft_path(&legacy_key);
        if !legacy_path.exists() {
            return Ok(None);
        }
        fs::read_to_string(&legacy_path)
            .map(Some)
            .map_err(|error| AppError::io("Read legacy draft", &legacy_path, error))
    }

    pub fn write_draft(
        &self,
        workspace_root: &str,
        relative_path: &str,
        content: &str,
    ) -> AppResult<()> {
        atomic_write(
            &self.draft_path(workspace_root, relative_path),
            content.as_bytes(),
        )
    }

    pub fn delete_draft(&self, workspace_root: &str, relative_path: &str) -> AppResult<()> {
        let path = self.draft_path(workspace_root, relative_path);
        if path.exists() {
            fs::remove_file(&path).map_err(|error| AppError::io("Delete draft", &path, error))?;
        }
        let legacy_key = format!("memoir:draft:{workspace_root}:{relative_path}");
        let legacy_path = self.legacy_draft_path(&legacy_key);
        if legacy_path.exists() {
            fs::remove_file(&legacy_path)
                .map_err(|error| AppError::io("Delete legacy draft", &legacy_path, error))?;
        }
        Ok(())
    }

    pub fn drafts_exist(
        &self,
        workspace_root: &str,
        relative_paths: &[String],
    ) -> AppResult<Vec<String>> {
        let hashed_dir = self
            .root
            .join("drafts")
            .join(stable_hash(workspace_root.as_bytes()));
        let mut found = Vec::new();
        if hashed_dir.is_dir() {
            let names = fs::read_dir(&hashed_dir)
                .into_iter()
                .flatten()
                .flatten()
                .filter_map(|entry| entry.file_name().into_string().ok())
                .collect::<HashSet<_>>();
            for path in relative_paths {
                if names.contains(&format!("{}.mdraft", stable_hash(path.as_bytes()))) {
                    found.push(path.clone());
                }
            }
        }

        let legacy_dir = self.root.join("drafts").join("legacy");
        if legacy_dir.is_dir() {
            let names = fs::read_dir(&legacy_dir)
                .into_iter()
                .flatten()
                .flatten()
                .filter_map(|entry| entry.file_name().into_string().ok())
                .collect::<HashSet<_>>();
            for path in relative_paths {
                let key = format!("memoir:draft:{workspace_root}:{path}");
                if names.contains(&format!("{}.mdraft", stable_hash(key.as_bytes()))) {
                    found.push(path.clone());
                }
            }
        }

        found.sort();
        found.dedup();
        Ok(found)
    }

    pub fn load_sync_snapshot(&self, workspace_root: &str) -> AppResult<SyncSnapshot> {
        let path = self.sync_snapshot_path(workspace_root);
        if !path.exists() {
            return Ok(SyncSnapshot {
                version: CLOUD_SYNC_SNAPSHOT_VERSION,
                files: Default::default(),
            });
        }
        let bytes =
            fs::read(&path).map_err(|error| AppError::io("Read sync snapshot", &path, error))?;
        let mut snapshot: SyncSnapshot =
            serde_json::from_slice(&bytes).map_err(AppError::serialization)?;
        snapshot.version = CLOUD_SYNC_SNAPSHOT_VERSION;
        Ok(snapshot)
    }

    pub fn save_sync_snapshot(
        &self,
        workspace_root: &str,
        snapshot: &SyncSnapshot,
    ) -> AppResult<()> {
        let mut snapshot = snapshot.clone();
        snapshot.version = CLOUD_SYNC_SNAPSHOT_VERSION;
        let bytes = serde_json::to_vec_pretty(&snapshot).map_err(AppError::serialization)?;
        atomic_write(&self.sync_snapshot_path(workspace_root), &bytes)
    }

    fn sync_snapshot_path(&self, workspace_root: &str) -> PathBuf {
        self.root
            .join("sync")
            .join(stable_hash(workspace_root.as_bytes()))
            .join("snapshot.json")
    }

    pub fn write_legacy_draft(&self, draft: &LegacyDraft) -> AppResult<()> {
        let path = match (&draft.workspace_root, &draft.relative_path) {
            (Some(root), Some(relative_path)) => self.draft_path(root, relative_path),
            _ => self.legacy_draft_path(&draft.legacy_key),
        };
        atomic_write(&path, draft.content.as_bytes())
    }

    fn state_path(&self) -> PathBuf {
        self.root.join("app-state.json")
    }

    fn draft_path(&self, workspace_root: &str, relative_path: &str) -> PathBuf {
        let workspace_hash = stable_hash(workspace_root.as_bytes());
        let note_hash = stable_hash(relative_path.as_bytes());
        self.root
            .join("drafts")
            .join(workspace_hash)
            .join(format!("{note_hash}.mdraft"))
    }

    fn legacy_draft_path(&self, legacy_key: &str) -> PathBuf {
        self.root
            .join("drafts")
            .join("legacy")
            .join(format!("{}.mdraft", stable_hash(legacy_key.as_bytes())))
    }
}

pub fn stable_hash(value: &[u8]) -> String {
    let digest = Sha256::digest(value);
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}
