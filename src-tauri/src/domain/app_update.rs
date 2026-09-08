use serde::Serialize;

pub const GITHUB_REPO_OWNER: &str = "Memoir-Studio";
pub const GITHUB_REPO_NAME: &str = "Memoir";
pub const GITHUB_REPO_URL: &str = "https://github.com/Memoir-Studio/Memoir";
pub const RELEASE_NOTES_MAX_CHARS: usize = 600;

const GITHUB_HOST_PREFIX: &str = "https://github.com/";
const GITHUB_REPO_PATH: &str = "Memoir-Studio/Memoir";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppUpdateStatus {
    UpToDate,
    Available,
    Skipped,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateCheck {
    pub status: AppUpdateStatus,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub release_url: Option<String>,
    pub release_notes: Option<String>,
}

pub fn parse_version(raw: &str) -> Option<(u64, u64, u64)> {
    let trimmed = raw.trim();
    let trimmed = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    let mut parts = trimmed.split('.');
    let major = parse_version_part(parts.next()?)?;
    let minor = parse_version_part(parts.next()?)?;
    let patch = parse_version_part(parts.next()?)?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

fn parse_version_part(part: &str) -> Option<u64> {
    if part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    part.parse().ok()
}

pub fn format_version((major, minor, patch): (u64, u64, u64)) -> String {
    format!("{major}.{minor}.{patch}")
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    match (parse_version(latest), parse_version(current)) {
        (Some(latest), Some(current)) => latest > current,
        _ => false,
    }
}

pub fn classify(current: &str, latest: Option<&str>, skipped: Option<&str>) -> AppUpdateStatus {
    let Some(latest) = latest else {
        return AppUpdateStatus::UpToDate;
    };
    if !is_newer(latest, current) {
        return AppUpdateStatus::UpToDate;
    }
    if skipped.is_some_and(|skipped| parse_version(skipped) == parse_version(latest)) {
        return AppUpdateStatus::Skipped;
    }
    AppUpdateStatus::Available
}

pub fn truncate_notes(body: Option<&str>) -> Option<String> {
    let trimmed = body.unwrap_or("").replace('\r', "");
    let trimmed = trimmed.trim();
    if trimmed.is_empty() {
        return None;
    }
    let mut chars = trimmed.chars();
    let taken: String = chars.by_ref().take(RELEASE_NOTES_MAX_CHARS).collect();
    if chars.next().is_some() {
        Some(format!("{taken}…"))
    } else {
        Some(taken)
    }
}

pub fn is_allowed_release_url(raw: &str) -> bool {
    let Some(rest) = raw.strip_prefix(GITHUB_HOST_PREFIX) else {
        return false;
    };
    rest == GITHUB_REPO_PATH
        || rest.starts_with("Memoir-Studio/Memoir/")
        || rest.starts_with("Memoir-Studio/Memoir?")
        || rest.starts_with("Memoir-Studio/Memoir#")
}

pub fn fallback_release_url(canonical_version: &str) -> String {
    format!("{GITHUB_REPO_URL}/releases/tag/v{canonical_version}")
}

pub fn build_update_check(
    current: &str,
    skipped: Option<&str>,
    tag_name: &str,
    html_url: &str,
    body: Option<&str>,
) -> AppUpdateCheck {
    let latest = parse_version(tag_name).map(format_version);
    let status = classify(current, latest.as_deref(), skipped);
    let release_url = latest.as_ref().map(|version| {
        if is_allowed_release_url(html_url) {
            html_url.to_string()
        } else {
            fallback_release_url(version)
        }
    });
    AppUpdateCheck {
        status,
        current_version: current.to_string(),
        latest_version: latest,
        release_url,
        release_notes: truncate_notes(body),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_version_accepts_optional_v_prefix() {
        assert_eq!(parse_version("0.1.7"), Some((0, 1, 7)));
        assert_eq!(parse_version("v0.1.7"), Some((0, 1, 7)));
        assert_eq!(parse_version("V1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("  v0.1.6  "), Some((0, 1, 6)));
    }

    #[test]
    fn parse_version_rejects_invalid_tags() {
        assert_eq!(parse_version(""), None);
        assert_eq!(parse_version("0.1"), None);
        assert_eq!(parse_version("0.1.7-beta"), None);
        assert_eq!(parse_version("v0.1.7.1"), None);
        assert_eq!(parse_version("latest"), None);
        assert_eq!(parse_version("01a.2.3"), None);
    }

    #[test]
    fn classify_compares_and_respects_skip() {
        assert_eq!(
            classify("0.1.6", Some("0.1.6"), None),
            AppUpdateStatus::UpToDate
        );
        assert_eq!(
            classify("0.1.7", Some("0.1.6"), None),
            AppUpdateStatus::UpToDate
        );
        assert_eq!(
            classify("0.1.6", Some("0.1.7"), None),
            AppUpdateStatus::Available
        );
        assert_eq!(
            classify("0.1.6", Some("v0.1.7"), Some("0.1.7")),
            AppUpdateStatus::Skipped
        );
        assert_eq!(
            classify("0.1.6", Some("0.1.8"), Some("0.1.7")),
            AppUpdateStatus::Available
        );
        assert_eq!(classify("0.1.6", None, None), AppUpdateStatus::UpToDate);
        assert_eq!(
            classify("0.1.6", Some("not-a-version"), None),
            AppUpdateStatus::UpToDate
        );
    }

    #[test]
    fn truncate_notes_caps_and_skips_empty() {
        assert_eq!(truncate_notes(None), None);
        assert_eq!(truncate_notes(Some("  \n")), None);
        assert_eq!(
            truncate_notes(Some("fixed\r\ncrash")),
            Some("fixed\ncrash".into())
        );
        let long = "a".repeat(RELEASE_NOTES_MAX_CHARS + 4);
        let truncated = truncate_notes(Some(&long)).unwrap();
        assert!(truncated.ends_with('…'));
        assert_eq!(truncated.chars().count(), RELEASE_NOTES_MAX_CHARS + 1);
    }

    #[test]
    fn allowed_release_url_stays_on_this_repo() {
        assert!(is_allowed_release_url(
            "https://github.com/Memoir-Studio/Memoir/releases/tag/v0.1.7"
        ));
        assert!(is_allowed_release_url(
            "https://github.com/Memoir-Studio/Memoir"
        ));
        assert!(!is_allowed_release_url(
            "https://github.com/Memoir-Studio/Memoir-evil"
        ));
        assert!(!is_allowed_release_url("https://evil.example/releases"));
        assert!(!is_allowed_release_url(
            "http://github.com/Memoir-Studio/Memoir"
        ));
    }

    #[test]
    fn build_update_check_canonicalizes_and_falls_back_url() {
        let available = build_update_check(
            "0.1.6",
            None,
            "v0.1.7",
            "https://github.com/Memoir-Studio/Memoir/releases/tag/v0.1.7",
            Some("notes"),
        );
        assert_eq!(available.status, AppUpdateStatus::Available);
        assert_eq!(available.latest_version.as_deref(), Some("0.1.7"));
        assert_eq!(
            available.release_url.as_deref(),
            Some("https://github.com/Memoir-Studio/Memoir/releases/tag/v0.1.7")
        );
        assert_eq!(available.release_notes.as_deref(), Some("notes"));

        let fallback = build_update_check("0.1.6", None, "0.1.7", "https://evil.example/x", None);
        assert_eq!(
            fallback.release_url.as_deref(),
            Some("https://github.com/Memoir-Studio/Memoir/releases/tag/v0.1.7")
        );
    }
}
