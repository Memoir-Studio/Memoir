use super::AppServices;
use crate::domain::{
    AppError, AttachmentFile, LibraryPage, LibraryQuery, NoteFile, NoteGraph, RenamedNote,
    WorkspaceIndexInfo,
};
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn reconcile_workspace(
    app: AppHandle,
    services: State<'_, AppServices>,
    root: String,
    query: Option<LibraryQuery>,
) -> Result<LibraryPage, AppError> {
    super::allow_workspace_media(&app, &root);
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
pub async fn create_folder(
    services: State<'_, AppServices>,
    root: String,
    folder: String,
) -> Result<String, AppError> {
    let workspace = services.workspace.clone();
    tauri::async_runtime::spawn_blocking(move || workspace.create_folder(&root, &folder))
        .await
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "Folder creation interrupted.")
                .with_details(error.to_string())
        })?
}

#[tauri::command]
pub fn rename_note(
    services: State<'_, AppServices>,
    root: String,
    old_relative_path: String,
    new_relative_path: String,
) -> Result<RenamedNote, AppError> {
    services.workspace.rename(&root, &old_relative_path, &new_relative_path)
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
pub async fn get_note_graph(
    services: State<'_, AppServices>,
    root: String,
) -> Result<NoteGraph, AppError> {
    let workspace = services.workspace.clone();
    tauri::async_runtime::spawn_blocking(move || workspace.note_graph(&root))
        .await
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "Note graph interrupted.")
                .with_details(error.to_string())
        })?
}

#[tauri::command]
pub async fn scan_attachments(
    app: AppHandle,
    services: State<'_, AppServices>,
    root: String,
) -> Result<Vec<AttachmentFile>, AppError> {
    super::allow_workspace_media(&app, &root);
    let workspace = services.workspace.clone();
    tauri::async_runtime::spawn_blocking(move || workspace.scan_attachments(&root))
        .await
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "Attachment scan interrupted.")
                .with_details(error.to_string())
        })?
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
    super::allow_workspace_media(&app, &root);
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
    super::allow_workspace_media(&app, &root);
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
