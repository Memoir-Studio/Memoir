use crate::{
    domain::{AppError, AppUpdateCheck},
    infrastructure::{github_releases, link_preview},
};
use super::AppServices;
use tauri::State;

#[tauri::command]
pub async fn check_app_update(
    services: State<'_, AppServices>,
) -> Result<AppUpdateCheck, AppError> {
    let app_state = services.app_state.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let skipped = app_state.load()?.skipped_update_version;
        let release = github_releases::fetch_latest_release()?;
        Ok(crate::domain::build_update_check(
            env!("CARGO_PKG_VERSION"),
            skipped.as_deref(),
            &release.tag_name,
            &release.html_url,
            release.body.as_deref(),
        ))
    })
    .await
    .map_err(|error| {
        AppError::new(crate::domain::ErrorCode::Io, "Unable to check for updates.")
            .with_details(error.to_string())
    })?
}

#[tauri::command]
pub async fn fetch_link_preview_html(url: String) -> Result<String, AppError> {
    tauri::async_runtime::spawn_blocking(move || link_preview::fetch_html(&url))
        .await
        .map_err(|error| {
            AppError::new(crate::domain::ErrorCode::Io, "Link preview interrupted.")
                .with_details(error.to_string())
        })?
}
