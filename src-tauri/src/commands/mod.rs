use crate::{
    domain::{
        AppError, AppSettings, AppState, FolderAppearance, LegacyStatePayload, MigrationResult,
        NoteFile,
    },
    services::{AppStateService, WorkspaceService},
};
use tauri::State;

#[derive(Debug, Clone)]
pub struct AppServices {
    pub workspace: WorkspaceService,
    pub app_state: AppStateService,
}

#[tauri::command]
pub fn scan_workspace(
    services: State<'_, AppServices>,
    root: String,
) -> Result<Vec<NoteFile>, AppError> {
    services.workspace.scan(&root)
}

#[tauri::command]
pub fn read_note(
    services: State<'_, AppServices>,
    root: String,
    relative_path: String,
) -> Result<String, AppError> {
    services.workspace.read(&root, &relative_path)
}

#[tauri::command]
pub fn write_note(
    services: State<'_, AppServices>,
    root: String,
    relative_path: String,
    content: String,
) -> Result<(), AppError> {
    services.workspace.write(&root, &relative_path, &content)
}

#[tauri::command]
pub fn create_note(
    services: State<'_, AppServices>,
    root: String,
    title: String,
    extension: String,
    folder: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<String, AppError> {
    services.workspace.create(
        &root,
        &title,
        &extension,
        folder.as_deref(),
        tags.as_deref(),
    )
}

#[tauri::command]
pub fn rename_note(
    services: State<'_, AppServices>,
    root: String,
    old_relative_path: String,
    new_relative_path: String,
) -> Result<String, AppError> {
    services
        .workspace
        .rename(&root, &old_relative_path, &new_relative_path)
}

#[tauri::command]
pub fn delete_note(
    services: State<'_, AppServices>,
    root: String,
    relative_path: String,
) -> Result<String, AppError> {
    services.workspace.delete(&root, &relative_path)
}

#[tauri::command]
pub fn load_app_state(services: State<'_, AppServices>) -> Result<AppState, AppError> {
    services.app_state.load()
}

#[tauri::command]
pub fn save_preferences(
    services: State<'_, AppServices>,
    preferences: AppSettings,
    last_workspace: Option<String>,
    sidebar_collapsed: bool,
) -> Result<AppState, AppError> {
    services
        .app_state
        .save_preferences(preferences, last_workspace, sidebar_collapsed)
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
