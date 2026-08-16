use crate::{
    domain::{
        attachment::ATTACHMENTS_DIR, AppError, AppSettings, AppState, AttachmentFile,
        FolderAppearance, LegacyStatePayload, LibraryPage, LibraryQuery, MigrationResult, NoteFile,
        RenamedNote, WorkspaceIndexInfo,
    },
    services::{AppStateService, WorkspaceService},
};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

fn allow_workspace_media(app: &AppHandle, root: &str) {
    let path = PathBuf::from(root);
    let path = path.canonicalize().unwrap_or(path);
    let scope = app.asset_protocol_scope();
    let _ = scope.allow_directory(&path, true);
    // Dot-directories are hidden from `**` globs on Unix, so allow the library explicitly.
    let _ = scope.allow_directory(path.join(ATTACHMENTS_DIR), true);
}

#[derive(Debug, Clone)]
pub struct AppServices {
    pub workspace: WorkspaceService,
    pub app_state: AppStateService,
}

#[tauri::command]
pub async fn reconcile_workspace(
    app: AppHandle,
    services: State<'_, AppServices>,
    root: String,
    query: Option<LibraryQuery>,
) -> Result<LibraryPage, AppError> {
    allow_workspace_media(&app, &root);
    let workspace = services.workspace.clone();
    let query = query.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || workspace.reconcile(&root, &query))
        .await
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "Workspace reconcile interrupted.")
                .with_details(error.to_string())
        })?
}

#[tauri::command]
pub async fn query_library(
    services: State<'_, AppServices>,
    root: String,
    query: LibraryQuery,
) -> Result<LibraryPage, AppError> {
    let workspace = services.workspace.clone();
    tauri::async_runtime::spawn_blocking(move || workspace.query_library(&root, &query))
        .await
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "Library query interrupted.")
                .with_details(error.to_string())
        })?
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
) -> Result<NoteFile, AppError> {
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
) -> Result<NoteFile, AppError> {
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
) -> Result<RenamedNote, AppError> {
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
pub async fn get_index_info(
    services: State<'_, AppServices>,
    root: String,
) -> Result<WorkspaceIndexInfo, AppError> {
    let workspace = services.workspace.clone();
    tauri::async_runtime::spawn_blocking(move || workspace.index_info(&root))
        .await
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "Index info interrupted.")
                .with_details(error.to_string())
        })?
}

#[tauri::command]
pub async fn rebuild_index(
    services: State<'_, AppServices>,
    root: String,
    query: Option<LibraryQuery>,
) -> Result<LibraryPage, AppError> {
    let workspace = services.workspace.clone();
    let query = query.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || workspace.rebuild_index(&root, &query))
        .await
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "Index rebuild interrupted.")
                .with_details(error.to_string())
        })?
}

#[tauri::command]
pub async fn scan_attachments(
    app: AppHandle,
    services: State<'_, AppServices>,
    root: String,
) -> Result<Vec<AttachmentFile>, AppError> {
    allow_workspace_media(&app, &root);
    let workspace = services.workspace.clone();
    tauri::async_runtime::spawn_blocking(move || workspace.scan_attachments(&root))
        .await
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "Attachment scan interrupted.")
                .with_details(error.to_string())
        })?
}

#[tauri::command]
pub fn drafts_exist(
    services: State<'_, AppServices>,
    workspace_root: String,
    relative_paths: Vec<String>,
) -> Result<Vec<String>, AppError> {
    services
        .app_state
        .drafts_exist(&workspace_root, &relative_paths)
}

#[tauri::command]
pub fn save_attachment(
    app: AppHandle,
    services: State<'_, AppServices>,
    root: String,
    bytes_base64: String,
    file_name: Option<String>,
    mime_type: Option<String>,
) -> Result<AttachmentFile, AppError> {
    allow_workspace_media(&app, &root);
    services.workspace.save_attachment(
        &root,
        &bytes_base64,
        file_name.as_deref(),
        mime_type.as_deref(),
    )
}

#[tauri::command]
pub fn import_attachment(
    app: AppHandle,
    services: State<'_, AppServices>,
    root: String,
    source_path: String,
) -> Result<AttachmentFile, AppError> {
    allow_workspace_media(&app, &root);
    services.workspace.import_attachment(&root, &source_path)
}

#[tauri::command]
pub fn delete_attachment(
    services: State<'_, AppServices>,
    root: String,
    relative_path: String,
) -> Result<String, AppError> {
    services.workspace.delete_attachment(&root, &relative_path)
}

#[tauri::command]
pub fn write_export_file(
    services: State<'_, AppServices>,
    path: String,
    bytes_base64: String,
) -> Result<(), AppError> {
    services.workspace.write_export_file(&path, &bytes_base64)
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
