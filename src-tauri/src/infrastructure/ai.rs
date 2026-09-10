use crate::domain::{AiSettings, AppError, AppResult, ErrorCode};
use reqwest::blocking::Client;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;

const EMBEDDING_BATCH_SIZE: usize = 64;

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingItem>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingItem {
    index: usize,
    embedding: Vec<f32>,
}

#[derive(Debug, Clone)]
pub struct EmbeddingClient {
    client: Client,
    endpoint: String,
    model: String,
    api_key: String,
}

impl EmbeddingClient {
    pub fn new(settings: &AiSettings) -> AppResult<Self> {
        let base = settings.base_url.trim().trim_end_matches('/');
        if base.is_empty() || settings.embedding_model.trim().is_empty() {
            return Err(AppError::new(
                ErrorCode::Io,
                "AI embedding service is not configured.",
            ));
        }
        let endpoint = format!("{base}/embeddings");
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(120))
            .build()
            .map_err(|error| {
                AppError::new(ErrorCode::Io, "Unable to create AI client.")
                    .with_details(error.to_string())
            })?;
        Ok(Self {
            client,
            endpoint,
            model: settings.embedding_model.trim().to_string(),
            api_key: settings.api_key.trim().to_string(),
        })
    }

    pub fn embed(&self, inputs: &[String]) -> AppResult<Vec<Vec<f32>>> {
        if inputs.is_empty() {
            return Ok(Vec::new());
        }
        let mut output = Vec::with_capacity(inputs.len());
        for batch in inputs.chunks(EMBEDDING_BATCH_SIZE) {
            let mut request = self
                .client
                .post(&self.endpoint)
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .json(&json!({ "model": self.model, "input": batch }));
            if !self.api_key.is_empty() {
                request = request.bearer_auth(&self.api_key);
            }
            let response = request.send().map_err(map_request_error)?;
            let status = response.status();
            let body = response.text().map_err(map_request_error)?;
            if !status.is_success() {
                return Err(AppError::new(ErrorCode::Io, "AI embedding request failed.")
                    .with_details(format!("HTTP {}: {}", status.as_u16(), truncate(&body))));
            }
            let parsed: EmbeddingResponse = serde_json::from_str(&body).map_err(|error| {
                AppError::new(
                    ErrorCode::Serialization,
                    "AI returned an invalid embedding response.",
                )
                .with_details(error.to_string())
            })?;
            let mut items = parsed.data;
            items.sort_by_key(|item| item.index);
            if items.len() != batch.len() || items.iter().any(|item| item.embedding.is_empty()) {
                return Err(AppError::new(
                    ErrorCode::Serialization,
                    "AI returned an incomplete embedding response.",
                ));
            }
            output.extend(items.into_iter().map(|item| normalize(item.embedding)));
        }
        Ok(output)
    }
}

fn normalize(mut vector: Vec<f32>) -> Vec<f32> {
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > f32::EPSILON {
        for value in &mut vector {
            *value /= norm;
        }
    }
    vector
}

fn truncate(value: &str) -> String {
    value.chars().take(500).collect()
}

fn map_request_error(error: reqwest::Error) -> AppError {
    AppError::new(ErrorCode::Io, "AI embedding request failed.").with_details(error.to_string())
}
