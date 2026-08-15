use crate::{
    domain::{
        path::{normalize_workspace_key, validate_relative_path},
        AppResult, AppSettings, AppState, FolderAppearance, LegacyStatePayload, MigrationResult,
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

    pub fn save_preferences(
        &self,
        preferences: AppSettings,
        last_workspace: Option<String>,
        sidebar_collapsed: bool,
    ) -> AppResult<AppState> {
        let _guard = self
            .state_lock
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let mut state = self.repository.load_state()?;
        state.preferences = preferences;
        state.sidebar_collapsed = sidebar_collapsed;
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
        let mut state = self.repository.load_state()?;
        let mut favorites = state
            .favorites
            .remove(&workspace_root)
            .unwrap_or_default()
            .into_iter()
            .collect::<BTreeSet<_>>();
        if favorite {
            favorites.insert(relative_path);
        } else {
            favorites.remove(&relative_path);
        }
        state
            .favorites
            .insert(workspace_root, favorites.into_iter().collect());
        self.repository.save_state(&state)?;
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
        let folder = validate_folder_key(&folder)?;
        let appearance = sanitize_folder_appearance(appearance);
        let mut state = self.repository.load_state()?;
        let mut workspace_map = state
            .folder_appearances
            .remove(&workspace_root)
            .unwrap_or_default();
        if let Some(appearance) = appearance {
            workspace_map.insert(folder, appearance);
        } else {
            workspace_map.remove(&folder);
        }
        if !workspace_map.is_empty() {
            state
                .folder_appearances
                .insert(workspace_root, workspace_map);
        }
        self.repository.save_state(&state)?;
        Ok(state)
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
