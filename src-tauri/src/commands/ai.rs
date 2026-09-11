use super::AppServices;
use crate::domain::{
    AiChatMessage, AiChatProgress, AiChatResponse, AiRewriteTarget, AiSettings, AppError,
    SemanticSearchResult, VectorIndexStatus,
};
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn get_vector_index_status(
    services: State<'_, AppServices>,
    root: String,
    settings: AiSettings,
) -> Result<VectorIndexStatus, AppError> {
    let service = services.vector_index.clone();
    tauri::async_runtime::spawn_blocking(move || service.status(&root, &settings))
        .await
        .map_err(|error| {
            AppError::new(
                crate::domain::ErrorCode::Io,
                "Vector index status interrupted.",
            )
            .with_details(error.to_string())
        })?
}

#[tauri::command]
pub async fn index_vector_workspace(
    services: State<'_, AppServices>,
    root: String,
    settings: AiSettings,
    force: Option<bool>,
) -> Result<VectorIndexStatus, AppError> {
    let service = services.vector_index.clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.index(&root, &settings, force.unwrap_or(false))
    })
    .await
    .map_err(|error| {
        AppError::new(crate::domain::ErrorCode::Io, "Vector indexing interrupted.")
            .with_details(error.to_string())
    })?
}

#[tauri::command]
pub async fn semantic_search(
    services: State<'_, AppServices>,
    root: String,
    settings: AiSettings,
    query: String,
    limit: Option<u32>,
) -> Result<Vec<SemanticSearchResult>, AppError> {
    let service = services.vector_index.clone();
    tauri::async_runtime::spawn_blocking(move || {
        service.search(&root, &settings, &query, limit.unwrap_or(20))
    })
    .await
    .map_err(|error| {
        AppError::new(crate::domain::ErrorCode::Io, "Semantic search interrupted.")
            .with_details(error.to_string())
    })?
}

#[tauri::command]
pub async fn chat_with_note(
    app: AppHandle,
    services: State<'_, AppServices>,
    root: String,
    settings: AiSettings,
    messages: Vec<AiChatMessage>,
    target: AiRewriteTarget,
    request_id: String,
) -> Result<AiChatResponse, AppError> {
    let service = services.vector_index.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::infrastructure::ai::ChatCompletionClient::new(&settings)?.chat(
            &messages,
            &target,
            |mut progress: AiChatProgress| {
                progress.request_id = Some(request_id.clone());
                let _ = app.emit(crate::domain::AI_CHAT_PROGRESS_EVENT, progress);
            },
            |query, limit| service.search(&root, &settings, query, limit),
        )
    })
    .await
    .map_err(|error| {
        AppError::new(
            crate::domain::ErrorCode::Io,
            "AI conversation was interrupted.",
        )
        .with_details(error.to_string())
    })?
}
