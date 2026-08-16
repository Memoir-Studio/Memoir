use crate::domain::{AppError, AppResult};
use std::path::{Component, Path};
use std::time::{SystemTime, UNIX_EPOCH};

pub const ATTACHMENTS_DIR: &str = "attachments";
pub const MAX_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;
pub const ATTACHMENT_EXTENSIONS: [&str; 8] = [
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg",
];

pub fn is_attachment_extension(extension: &str) -> bool {
    ATTACHMENT_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
}

pub fn is_attachment_root_name(name: &std::ffi::OsStr) -> bool {
    name == ATTACHMENTS_DIR
}

pub fn is_attachment_relative(relative: &Path) -> bool {
    let mut components = relative.components();
    matches!(
        components.next(),
        Some(Component::Normal(name)) if is_attachment_root_name(name)
    ) && components.next().is_some()
}

pub fn attachment_month_dir() -> String {
    attachment_month_dir_at(SystemTime::now())
}

pub fn attachment_month_dir_at(now: SystemTime) -> String {
    let secs = now
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let (year, month) = unix_utc_year_month(secs);
    format!("{year:04}-{month:02}")
}

fn unix_utc_year_month(secs: u64) -> (i32, u32) {
    let days = (secs / 86_400) as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    (year as i32, month as u32)
}

pub fn validate_attachment_extension(path: &Path) -> AppResult<String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if is_attachment_extension(&extension) {
        Ok(extension)
    } else {
        Err(AppError::unsupported_attachment())
    }
}

pub fn mime_from_extension(extension: &str) -> &'static str {
    match extension.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

pub fn extension_from_mime(mime: &str) -> Option<&'static str> {
    match mime.trim().to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/bmp" | "image/x-ms-bmp" => Some("bmp"),
        "image/avif" => Some("avif"),
        "image/svg+xml" => Some("svg"),
        _ => None,
    }
}

pub fn sniff_image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Some("png");
    }
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return Some("jpg");
    }
    if bytes.starts_with(b"GIF8") {
        return Some("gif");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.starts_with(b"BM") {
        return Some("bmp");
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        let brand = &bytes[8..12];
        if brand == b"avif" || brand == b"avis" {
            return Some("avif");
        }
    }
    None
}

pub fn looks_like_svg(bytes: &[u8]) -> bool {
    let preview = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).to_ascii_lowercase();
    preview.contains("<svg") || (preview.contains("<?xml") && preview.contains("svg"))
}

pub fn sanitize_attachment_file_name(name: &str) -> String {
    let normalized = name.replace('\\', "/");
    let base = normalized
        .rsplit('/')
        .next()
        .unwrap_or(name)
        .trim();
    let mut slug = String::new();
    let mut last_dash = false;
    for character in base.chars() {
        if character == '.' {
            if !slug.is_empty() && !slug.ends_with('.') {
                slug.push('.');
            }
            last_dash = false;
            continue;
        }
        if character.is_alphanumeric() || character == '_' {
            slug.push(character);
            last_dash = false;
            continue;
        }
        if !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
    }
    let slug = slug.trim_matches(|c| c == '.' || c == '-');
    if slug.is_empty() {
        "image".into()
    } else {
        slug.into()
    }
}

pub fn resolve_attachment_extension(
    file_name: Option<&str>,
    mime_type: Option<&str>,
    bytes: &[u8],
) -> AppResult<String> {
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(AppError::attachment_too_large());
    }
    if bytes.is_empty() {
        return Err(AppError::unsupported_attachment());
    }
    let sniffed = sniff_image_extension(bytes);
    let named = file_name
        .and_then(|name| Path::new(name).extension())
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| is_attachment_extension(value));
    let mimed = mime_type.and_then(extension_from_mime).map(str::to_string);
    let extension = sniffed
        .map(str::to_string)
        .or(named)
        .or(mimed)
        .ok_or_else(AppError::unsupported_attachment)?;
    if extension == "svg" && !looks_like_svg(bytes) {
        return Err(AppError::unsupported_attachment());
    }
    Ok(extension)
}

pub fn unique_file_name(preferred: &str, existing: impl Fn(&str) -> bool) -> String {
    let path = Path::new(preferred);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("image");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");
    for index in 0..1000 {
        let candidate = if index == 0 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem}-{index}.{extension}")
        };
        if !existing(&candidate) {
            return candidate;
        }
    }
    format!("{stem}-overflow.{extension}")
}
