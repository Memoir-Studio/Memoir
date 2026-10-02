use crate::{
    domain::{
        app_update::{format_version, parse_version},
        cloud_sync::{sanitize_profile, CloudSyncProfile},
        path::{normalize_workspace_key, validate_relative_path},
        AiConversation, AppError, AppResult, AppSettings, AppState, ErrorCode, FolderAppearance,
        LegacyStatePayload, MigrationResult, WorkspaceLayout, WorkspaceState,
    },
    infrastructure::app_data::AppDataRepository,
};
use std::{
    collections::BTreeSet,
    sync::{Arc, Mutex},
};

#[derive(Debug, Clone)]
pub struct AppStateService {
    repository: AppDataRepository,
    state_lock: Arc<Mutex<()>>,
}

impl AppStateService {
    pub fn new(repository: AppDataRepository) -> Self {
        Self {
            repository,
            state_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn load(&self) -> AppResult<AppState> {
        self.repository.load_state()
    }

    pub fn load_for_workspace(&self, workspace_root: Option<&str>) -> AppResult<AppState> {
        let _guard = self.state_lock.lock().unwrap_or_else(|error| error.into_inner());
        let mut state = self.repository.load_state()?;
        let root = workspace_root
            .map(str::to_string)
            .or_else(|| state.last_workspace.clone());
        let Some(root) = root else {
            return Ok(state);
        };
        let workspace_root = match normalize_workspace_key(&root) {
            Ok(root) => root,
            Err(_) if workspace_root.is_none() => return Ok(state),
            Err(error) => return Err(error),
        };
        let workspace_state = self.workspace_state(&mut state, &workspace_root)?;
        project_workspace_state(&mut state, workspace_root, workspace_state);
        Ok(state)
    }

    // Write the workspace file before removing legacy data, so failed migration is retryable.
    fn workspace_state(&self, state: &mut AppState, root: &str) -> AppResult<WorkspaceState> {
        let path = std::path::Path::new(root);
        let existing = self.repository.load_workspace_state(path)?;
        let favorites = state.favorites.remove(root);
        let folder_appearances = state.folder_appearances.remove(root);
        let has_legacy = favorites.is_some() || folder_appearances.is_some();
        let workspace_state = match existing {
            Some(existing) => existing,
            None => {
                let migrated = WorkspaceState {
                    favorites: favorites.unwrap_or_default(),
                    folder_appearances: folder_appearances.unwrap_or_default(),
                };
                if has_legacy {
                    self.repository.save_workspace_state(path, &migrated)?;
                }
                migrated
            }
        };
        if has_legacy {
            self.repository.save_state(state)?;
        }
        Ok(workspace_state)
    }

    pub fn load_ai_conversations(&self, workspace_root: &str) -> AppResult<Vec<AiConversation>> {
        self.repository.load_ai_conversations(&normalize_workspace_key(workspace_root)?)
    }

    pub fn save_ai_conversations(
        &self,
        workspace_root: &str,
        conversations: &[AiConversation],
    ) -> AppResult<()> {
        let normalized = normalize_workspace_key(workspace_root)?;
        let _guard = self.state_lock.lock().unwrap_or_else(|error| error.into_inner());
        self.repository.save_ai_conversations(&normalized, conversations)
    }

    pub fn set_last_open_note(
        &self,
        workspace_root: String,
        relative_path: Option<String>,
    ) -> AppResult<()> {
        let workspace_root = normalize_workspace_key(&workspace_root)?;
        if let Some(path) = &relative_path {
            validate_relative_path(path)?;
        }
        let _guard = self.state_lock.lock().unwrap_or_else(|error| error.into_inner());
        let mut state = self.repository.load_state()?;
        if let Some(path) = relative_path {
            state.last_open_notes.insert(workspace_root, path);
        } else {
            state.last_open_notes.remove(&workspace_root);
        }
        self.repository.save_state(&state)
    }

    pub fn save_preferences(
        &self,
        preferences: AppSettings,
        last_workspace: Option<String>,
        sidebar_collapsed: bool,
        layout: Option<WorkspaceLayout>,
    ) -> AppResult<AppState> {
        let _guard = self
            .state_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut state = self.repository.load_state()?;
        state.preferences = preferences;
        state.sidebar_collapsed = sidebar_collapsed;
        if let Some(layout) = layout {
            state.layout = layout.sanitized();
        }
        let last_workspace = last_workspace
            .map(|workspace| normalize_workspace_key(&workspace).unwrap_or(workspace));
        state.last_workspace = last_workspace.clone();
        if let Some(workspace) = last_workspace {
            state.recent_workspaces.retain(|item| item != &workspace);
            state.recent_workspaces.insert(0, workspace);
            state.recent_workspaces.truncate(10);
        }
        self.repository.save_state(&state)?;
        Ok(state)
    }

    pub fn save_window_frame(
        &self,
        width: f64,
        height: f64,
        maximized: bool,
    ) -> AppResult<AppState> {
        let _guard = self
            .state_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut state = self.repository.load_state()?;
        let next = state
            .window
            .clone()
            .with_live_size(width, height, maximized);
        if next == state.window {
            return Ok(state);
        }
        state.window = next;
        self.repository.save_state(&state)?;
        Ok(state)
    }

    pub fn set_favorite(
        &self,
        workspace_root: String,
        relative_path: String,
        favorite: bool,
    ) -> AppResult<AppState> {
        let _guard = self
            .state_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let workspace_root = normalize_workspace_key(&workspace_root)?;
        validate_relative_path(&relative_path)?;
        let root = std::path::PathBuf::from(&workspace_root);
        let mut state = self.repository.load_state()?;
        let mut workspace_state = self.workspace_state(&mut state, &workspace_root)?;
        let mut favorites = workspace_state.favorites.into_iter().collect::<BTreeSet<_>>();
        if favorite {
            favorites.insert(relative_path);
        } else {
            favorites.remove(&relative_path);
        }
        workspace_state.favorites = favorites.into_iter().collect();
        self.repository.save_workspace_state(&root, &workspace_state)?;
        project_workspace_state(&mut state, workspace_root, workspace_state);
        Ok(state)
    }

    pub fn set_folder_appearance(
        &self,
        workspace_root: String,
        folder: String,
        appearance: Option<FolderAppearance>,
    ) -> AppResult<AppState> {
        let _guard = self
            .state_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let workspace_root = normalize_workspace_key(&workspace_root)?;
        let root = std::path::PathBuf::from(&workspace_root);
        let folder = validate_folder_key(&folder)?;
        let appearance = sanitize_folder_appearance(appearance);
        let mut state = self.repository.load_state()?;
        let mut workspace_state = self.workspace_state(&mut state, &workspace_root)?;
        let mut workspace_map = workspace_state.folder_appearances;
        if let Some(appearance) = appearance {
            workspace_map.insert(folder, appearance);
        } else {
            workspace_map.remove(&folder);
        }
        workspace_state.folder_appearances = workspace_map;
        self.repository.save_workspace_state(&root, &workspace_state)?;
        project_workspace_state(&mut state, workspace_root, workspace_state);
        Ok(state)
    }

    pub fn skip_update_version(&self, version: String) -> AppResult<AppState> {
        let canonical = parse_version(&version).map(format_version).ok_or_else(|| {
            AppError::new(ErrorCode::Io, "Unable to skip this update version.")
                .with_details("Version must be major.minor.patch.")
        })?;
        let _guard = self
            .state_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut state = self.repository.load_state()?;
        if state.skipped_update_version.as_deref() == Some(canonical.as_str()) {
            return Ok(state);
        }
        state.skipped_update_version = Some(canonical);
        self.repository.save_state(&state)?;
        Ok(state)
    }

    pub fn cloud_sync_profile(&self, workspace_root: &str) -> AppResult<CloudSyncProfile> {
        let workspace_root =
            normalize_workspace_key(workspace_root).unwrap_or_else(|_| workspace_root.to_string());
        let state = self.repository.load_state()?;
        Ok(state
            .cloud_sync
            .get(&workspace_root)
            .cloned()
            .unwrap_or_default())
    }

    pub fn save_cloud_sync_profile(
        &self,
        workspace_root: String,
        profile: CloudSyncProfile,
    ) -> AppResult<CloudSyncProfile> {
        let _guard = self
            .state_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let workspace_root = normalize_workspace_key(&workspace_root)?;
        let profile = sanitize_profile(profile)?;
        let mut state = self.repository.load_state()?;
        state.cloud_sync.insert(workspace_root, profile.clone());
        self.repository.save_state(&state)?;
        Ok(profile)
    }

    pub fn drafts_exist(
        &self,
        workspace_root: &str,
        relative_paths: &[String],
    ) -> AppResult<Vec<String>> {
        let normalized =
            normalize_workspace_key(workspace_root).unwrap_or_else(|_| workspace_root.to_string());
        let mut found = self.repository.drafts_exist(&normalized, relative_paths)?;
        if normalized != workspace_root {
            found.extend(
                self.repository
                    .drafts_exist(workspace_root, relative_paths)?,
            );
        }
        found.sort();
        found.dedup();
        Ok(found)
    }

    pub fn read_draft(
        &self,
        workspace_root: &str,
        relative_path: &str,
    ) -> AppResult<Option<String>> {
        let normalized =
            normalize_workspace_key(workspace_root).unwrap_or_else(|_| workspace_root.to_string());
        let draft = self.repository.read_draft(&normalized, relative_path)?;
        if draft.is_some() || normalized == workspace_root {
            Ok(draft)
        } else {
            self.repository.read_draft(workspace_root, relative_path)
        }
    }

    pub fn write_draft(
        &self,
        workspace_root: &str,
        relative_path: &str,
        content: &str,
    ) -> AppResult<()> {
        let normalized =
            normalize_workspace_key(workspace_root).unwrap_or_else(|_| workspace_root.to_string());
        self.repository
            .write_draft(&normalized, relative_path, content)
    }

    pub fn delete_draft(&self, workspace_root: &str, relative_path: &str) -> AppResult<()> {
        let normalized =
            normalize_workspace_key(workspace_root).unwrap_or_else(|_| workspace_root.to_string());
        self.repository.delete_draft(&normalized, relative_path)?;
        if normalized != workspace_root {
            self.repository
                .delete_draft(workspace_root, relative_path)?;
        }
        Ok(())
    }

    pub fn migrate_legacy_state(&self, payload: LegacyStatePayload) -> AppResult<MigrationResult> {
        let _guard = self
            .state_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut state = self.repository.load_state()?;
        let mut migrated_keys = Vec::new();

        if let Some(settings) = payload.settings {
            state.preferences = settings;
            migrated_keys.push("memoir:settings".into());
            migrated_keys.push("memoir:theme".into());
        }
        if let Some(workspace) = payload.last_workspace {
            let workspace = normalize_workspace_key(&workspace).unwrap_or(workspace);
            state.last_workspace = Some(workspace.clone());
            state.recent_workspaces.retain(|item| item != &workspace);
            state.recent_workspaces.insert(0, workspace);
            migrated_keys.push("memoir:last-workspace".into());
        }
        if let Some(collapsed) = payload.sidebar_collapsed {
            state.sidebar_collapsed = collapsed;
            migrated_keys.push("memoir:sidebar-collapsed".into());
        }
        if let Some(favorites) = payload.favorites {
            if let Some(root) = state.last_workspace.clone() {
                state.favorites.insert(root, favorites);
                migrated_keys.push("memoir:favorites".into());
            }
        }

        for draft in &payload.drafts {
            self.repository.write_legacy_draft(draft)?;
            migrated_keys.push(draft.legacy_key.clone());
        }

        self.repository.save_state(&state)?;
        migrated_keys.sort();
        migrated_keys.dedup();
        Ok(MigrationResult { migrated_keys })
    }
}

fn project_workspace_state(state: &mut AppState, root: String, workspace: WorkspaceState) {
    state.favorites.insert(root.clone(), workspace.favorites);
    state
        .folder_appearances
        .insert(root, workspace.folder_appearances);
}

fn validate_folder_key(folder: &str) -> AppResult<String> {
    let normalized = folder.trim().trim_matches('/').trim_matches('\\');
    if normalized.is_empty() {
        return Ok(String::new());
    }
    validate_relative_path(normalized)?;
    Ok(normalized.to_string())
}

const FOLDER_COLORS: &[&str] = &["coral", "blue", "green", "gold", "violet", "slate", "ink"];

fn sanitize_folder_appearance(appearance: Option<FolderAppearance>) -> Option<FolderAppearance> {
    let appearance = appearance?;
    let emoji = appearance.emoji.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() || trimmed.len() > 32 || trimmed.chars().any(char::is_control) {
            None
        } else {
            Some(trimmed.to_string())
        }
    });
    let color = appearance
        .color
        .filter(|value| FOLDER_COLORS.contains(&value.as_str()));
    if emoji.is_none() && color.is_none() {
        None
    } else {
        Some(FolderAppearance { emoji, color })
    }
}
