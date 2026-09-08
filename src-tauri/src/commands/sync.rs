use super::AppServices;
use crate::domain::{AppError, CloudSyncProbe, CloudSyncProfile, CloudSyncRunResult};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn get_cloud_sync_profile(
    services: State<'_, AppServices>,
    workspace_root: String,
) -> Result<CloudSyncProfile, AppError> {
    services.cloud_sync.profile(&workspace_root)
}

#[tauri::command]
pub fn save_cloud_sync_profile(
    services: State<'_, AppServices>,
    workspace_root: String,
    profile: CloudSyncProfile,
) -> Result<CloudSyncProfile, AppError> {
    services.cloud_sync.save_profile(&workspace_root, profile)
}

#[tauri::command]
pub async fn test_cloud_sync(
    services: State<'_, AppServices>,
    profile: CloudSyncProfile,
) -> Result<CloudSyncProbe, AppError> {
    let cloud_sync = services.cloud_sync.clone();
    tauri::async_runtime::spawn_blocking(move || cloud_sync.test_connection(profile))
        .await
        .map_err(|error| {
            AppError::new(
                crate::domain::ErrorCode::Io,
                "Cloud connection test interrupted.",
            )
            .with_details(error.to_string())
        })?
}

#[tauri::command]
pub async fn run_cloud_sync(
    app: AppHandle,
    services: State<'_, AppServices>,
    workspace_root: String,
    profile: Option<CloudSyncProfile>,
) -> Result<CloudSyncRunResult, AppError> {
    let cloud_sync = services.cloud_sync.clone();
    tauri::async_runtime::spawn_blocking(move || {
        cloud_sync.run_sync(
            &workspace_root,
            profile,
            Some(Arc::new(move |progress| {
                let _ = app.emit(crate::domain::CLOUD_SYNC_PROGRESS_EVENT, progress);
            })),
        )
    })
    .await
    .map_err(|error| {
        AppError::new(crate::domain::ErrorCode::Io, "Cloud sync interrupted.")
            .with_details(error.to_string())
    })?
}
