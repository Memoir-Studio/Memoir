use crate::domain::{
    app_update::{GITHUB_REPO_NAME, GITHUB_REPO_OWNER},
    AppError, AppResult, ErrorCode,
};
use reqwest::blocking::Client;
use reqwest::header::ACCEPT;
use serde::Deserialize;
use std::time::Duration;

const REQUEST_TIMEOUT_SECS: u64 = 8;
const CONNECT_TIMEOUT_SECS: u64 = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubLatestRelease {
    pub tag_name: String,
    pub html_url: String,
    pub body: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubReleaseResponse {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
}

pub fn latest_release_url() -> String {
    format!("https://api.github.com/repos/{GITHUB_REPO_OWNER}/{GITHUB_REPO_NAME}/releases/latest")
}

pub fn parse_release_json(bytes: &[u8]) -> AppResult<GitHubLatestRelease> {
    let parsed: GitHubReleaseResponse = serde_json::from_slice(bytes).map_err(|error| {
        AppError::new(ErrorCode::Io, "GitHub release response was invalid.")
            .with_details(error.to_string())
    })?;
    if parsed.tag_name.trim().is_empty() {
        return Err(
            AppError::new(ErrorCode::Io, "GitHub release response was invalid.")
                .with_details("Release tag_name was empty."),
        );
    }
    Ok(GitHubLatestRelease {
        tag_name: parsed.tag_name,
        html_url: parsed.html_url,
        body: parsed.body.filter(|body| !body.trim().is_empty()),
    })
}

pub fn fetch_latest_release() -> AppResult<GitHubLatestRelease> {
    let client = Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent(format!("Memoir/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(map_reqwest)?;
    let response = client
        .get(latest_release_url())
        .header(ACCEPT, "application/vnd.github+json")
        .send()
        .map_err(map_reqwest)?;
    let status = response.status();
    if !status.is_success() {
        return Err(map_http_status(status));
    }
    let bytes = response.bytes().map_err(map_reqwest)?;
    parse_release_json(&bytes)
}

fn map_http_status(status: reqwest::StatusCode) -> AppError {
    let code = status.as_u16();
    let message = match code {
        404 => "No published GitHub release was found.",
        403 | 429 => "GitHub rate-limited the request.",
        _ => "GitHub returned an error.",
    };
    AppError::new(ErrorCode::Io, message).with_details(format!("HTTP {code}"))
}

fn map_reqwest(error: reqwest::Error) -> AppError {
    let message = if error.is_timeout() {
        "The GitHub request timed out."
    } else if error.is_connect() {
        "Couldn't reach GitHub."
    } else {
        "Unable to check for updates."
    };
    AppError::new(ErrorCode::Io, message).with_details(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_release_json_reads_tag_url_and_body() {
        let payload = br#"{
            "tag_name": "v0.1.7",
            "html_url": "https://github.com/Memoir-Studio/Memoir/releases/tag/v0.1.7",
            "body": "Fixes a crash."
        }"#;
        let release = parse_release_json(payload).unwrap();
        assert_eq!(release.tag_name, "v0.1.7");
        assert_eq!(
            release.html_url,
            "https://github.com/Memoir-Studio/Memoir/releases/tag/v0.1.7"
        );
        assert_eq!(release.body.as_deref(), Some("Fixes a crash."));
    }

    #[test]
    fn parse_release_json_rejects_missing_tag() {
        let payload = br#"{"html_url":"https://github.com/Memoir-Studio/Memoir/releases/latest"}"#;
        assert_eq!(parse_release_json(payload).unwrap_err().code, ErrorCode::Io);
        let empty_tag = br#"{"tag_name":"","html_url":"https://github.com/Memoir-Studio/Memoir"}"#;
        assert_eq!(
            parse_release_json(empty_tag).unwrap_err().code,
            ErrorCode::Io
        );
    }

    #[test]
    fn http_status_messages_include_the_reason() {
        let missing = map_http_status(reqwest::StatusCode::NOT_FOUND);
        assert_eq!(missing.message, "No published GitHub release was found.");
        assert_eq!(missing.details.as_deref(), Some("HTTP 404"));
        let limited = map_http_status(reqwest::StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(limited.message, "GitHub rate-limited the request.");
        assert_eq!(limited.details.as_deref(), Some("HTTP 429"));
    }
}
