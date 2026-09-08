use super::AppServices;
use crate::{
    domain::{
        AppError, AppSettings, AppState, FolderAppearance, LegacyStatePayload, MigrationResult,
        WorkspaceLayout,
    },
    tray::ClosePolicy,
};
use std::sync::Arc;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn load_app_state(services: State<'_, AppServices>) -> Result<AppState, AppError> {
    services.app_state.load()
}

#[tauri::command]
pub fn drafts_exist(
    services: State<'_, AppServices>,
    workspace_root: String,
    relative_paths: Vec<String>,
) -> Result<Vec<String>, AppError> {
    services.app_state.drafts_exist(&workspace_root, &relative_paths)
}

#[tauri::command]
pub fn skip_app_update(
    services: State<'_, AppServices>,
    version: String,
) -> Result<AppState, AppError> {
    services.app_state.skip_update_version(version)
}

#[tauri::command]
pub fn save_preferences(
    app: AppHandle,
    services: State<'_, AppServices>,
    close_policy: State<'_, Arc<ClosePolicy>>,
    preferences: AppSettings,
    last_workspace: Option<String>,
    sidebar_collapsed: bool,
    layout: Option<WorkspaceLayout>,
) -> Result<AppState, AppError> {
    let state = services.app_state.save_preferences(
        preferences,
        last_workspace,
        sidebar_collapsed,
        layout,
    )?;
    crate::tray::sync_from_preferences(&app, &state.preferences, close_policy.as_ref());
    Ok(state)
}

#[tauri::command]
pub fn set_favorite(
    services: State<'_, AppServices>,
    workspace_root: String,
    relative_path: String,
    favorite: bool,
) -> Result<AppState, AppError> {
    services
        .app_state
        .set_favorite(workspace_root, relative_path, favorite)
}

#[tauri::command]
pub fn set_folder_appearance(
    services: State<'_, AppServices>,
    workspace_root: String,
    folder: String,
    appearance: Option<FolderAppearance>,
) -> Result<AppState, AppError> {
    services
        .app_state
        .set_folder_appearance(workspace_root, folder, appearance)
}

#[tauri::command]
pub fn read_draft(
    services: State<'_, AppServices>,
    workspace_root: String,
    relative_path: String,
) -> Result<Option<String>, AppError> {
    services
        .app_state
        .read_draft(&workspace_root, &relative_path)
}

#[tauri::command]
pub fn write_draft(
    services: State<'_, AppServices>,
    workspace_root: String,
    relative_path: String,
    content: String,
) -> Result<(), AppError> {
    services
        .app_state
        .write_draft(&workspace_root, &relative_path, &content)
}

#[tauri::command]
pub fn delete_draft(
    services: State<'_, AppServices>,
    workspace_root: String,
    relative_path: String,
) -> Result<(), AppError> {
    services
        .app_state
        .delete_draft(&workspace_root, &relative_path)
}

#[tauri::command]
pub fn migrate_legacy_state(
    services: State<'_, AppServices>,
    payload: LegacyStatePayload,
) -> Result<MigrationResult, AppError> {
    services.app_state.migrate_legacy_state(payload)
}
