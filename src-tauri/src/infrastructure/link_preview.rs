use crate::domain::{AppError, AppResult, ErrorCode};
use reqwest::blocking::Client;
use reqwest::header::ACCEPT;
use std::time::Duration;
use url::Url;

const REQUEST_TIMEOUT_SECS: u64 = 8;
const CONNECT_TIMEOUT_SECS: u64 = 5;
const MAX_HTML_BYTES: usize = 256 * 1024;

pub fn validate_preview_url(input: &str) -> AppResult<Url> {
    let parsed = Url::parse(input.trim()).map_err(|error| {
        AppError::invalid_path("The URL is invalid.").with_details(error.to_string())
    })?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(AppError::invalid_path(
            "Only http(s) URLs can be previewed.",
        ));
    }
    if parsed.host_str().unwrap_or("").is_empty() {
        return Err(AppError::invalid_path("The URL is missing a host."));
    }
    Ok(parsed)
}

pub fn fetch_html(url: &str) -> AppResult<String> {
    let parsed = validate_preview_url(url)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent(format!(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Memoir/{}",
            env!("CARGO_PKG_VERSION")
        ))
        .build()
        .map_err(map_reqwest)?;
    let response = client
        .get(parsed)
        .header(
            ACCEPT,
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        )
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .map_err(map_reqwest)?;
    let status = response.status();
    if !status.is_success() {
        return Err(
            AppError::new(ErrorCode::Io, "Unable to load the link preview.")
                .with_details(format!("HTTP {}", status.as_u16())),
        );
    }
    let bytes = response.bytes().map_err(map_reqwest)?;
    let sliced = if bytes.len() > MAX_HTML_BYTES {
        &bytes[..MAX_HTML_BYTES]
    } else {
        &bytes
    };
    Ok(String::from_utf8_lossy(sliced).into_owned())
}

fn map_reqwest(error: reqwest::Error) -> AppError {
    let message = if error.is_timeout() {
        "The link preview timed out."
    } else if error.is_connect() {
        "Couldn't reach the link."
    } else {
        "Unable to load the link preview."
    };
    AppError::new(ErrorCode::Io, message).with_details(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_http_and_https_urls() {
        assert!(validate_preview_url("https://shiyu.dev/article/320").is_ok());
        assert!(validate_preview_url("http://example.com").is_ok());
    }

    #[test]
    fn rejects_non_http_urls() {
        assert_eq!(
            validate_preview_url("file:///tmp/note.md")
                .unwrap_err()
                .code,
            ErrorCode::InvalidPath
        );
        assert_eq!(
            validate_preview_url("javascript:alert(1)")
                .unwrap_err()
                .code,
            ErrorCode::InvalidPath
        );
        assert_eq!(
            validate_preview_url("not a url").unwrap_err().code,
            ErrorCode::InvalidPath
        );
    }
}
