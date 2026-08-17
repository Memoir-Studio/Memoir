use super::CloudProvider;
use crate::domain::{
    cloud_sync::{is_syncable_relative, sanitize_remote_prefix, CloudSyncProfile, FileIdentity},
    AppError, AppResult, ErrorCode,
};
use percent_encoding::percent_decode_str;
use quick_xml::events::Event;
use quick_xml::Reader;
use reqwest::blocking::{Client, RequestBuilder};
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE};
use reqwest::Method;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use url::Url;

const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:getlastmodified/>
    <d:getcontentlength/>
    <d:getetag/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DepthMode {
    Unknown,
    Infinity,
    Depth1,
}

#[derive(Debug)]
struct WebDavSession {
    collections: Mutex<HashSet<String>>,
    depth_mode: Mutex<DepthMode>,
    listed: AtomicBool,
}

#[derive(Debug, Clone)]
pub struct WebDavProvider {
    client: Client,
    base: Url,
    username: String,
    password: String,
    session: std::sync::Arc<WebDavSession>,
}

#[derive(Debug, Clone)]
struct PropFindItem {
    href: String,
    size: u64,
    modified_ms: u128,
    etag: Option<String>,
    collection: bool,
}

impl WebDavProvider {
    pub fn from_profile(profile: &CloudSyncProfile) -> AppResult<Self> {
        let prefix = sanitize_remote_prefix(&profile.remote_prefix)?;
        let base = parse_base_url(&profile.webdav.url, &prefix)?;
        let client = Client::builder()
            .timeout(Duration::from_secs(300))
            .connect_timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::limited(5))
            .danger_accept_invalid_certs(profile.webdav.insecure_tls)
            .user_agent("Memoir/0.1")
            .build()
            .map_err(|error| {
                AppError::new(ErrorCode::Io, "Unable to create the WebDAV client.")
                    .with_details(error.to_string())
            })?;
        Ok(Self {
            client,
            base,
            username: profile.webdav.username.clone(),
            password: profile.webdav.password.clone(),
            session: std::sync::Arc::new(WebDavSession {
                collections: Mutex::new(HashSet::new()),
                depth_mode: Mutex::new(DepthMode::Unknown),
                listed: AtomicBool::new(false),
            }),
        })
    }

    fn request(&self, method: Method, url: &Url) -> RequestBuilder {
        let mut headers = HeaderMap::new();
        headers.insert(
            CONTENT_TYPE,
            HeaderValue::from_static("application/xml; charset=utf-8"),
        );
        self.client
            .request(method, url.clone())
            .headers(headers)
            .basic_auth(&self.username, Some(&self.password))
    }

    fn object_url(&self, relative_path: &str) -> AppResult<Url> {
        join_remote(&self.base, relative_path)
    }

    fn remember_collection(&self, relative: &str) {
        self.session
            .collections
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(relative.to_string());
    }

    fn knows_collection(&self, relative: &str) -> bool {
        self.session
            .collections
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .contains(relative)
    }

    fn remember_collections_from(&self, items: &[PropFindItem]) {
        for item in items {
            if !item.collection {
                continue;
            }
            if let Some(relative) = href_to_relative(&self.base, &item.href) {
                self.remember_collection(&relative);
            }
        }
    }

    fn ensure_parents(&self, relative_path: &str) -> AppResult<()> {
        for prefix in parent_collection_prefixes(relative_path) {
            if self.knows_collection(&prefix) {
                continue;
            }
            self.mkcol(&join_remote(&self.base, &prefix)?)?;
            self.remember_collection(&prefix);
        }
        Ok(())
    }

    fn mkcol(&self, url: &Url) -> AppResult<()> {
        let method = Method::from_bytes(b"MKCOL").unwrap();
        let response = self.request(method, url).send().map_err(map_reqwest)?;
        let status = response.status();
        if status.is_success()
            || status.as_u16() == 405
            || status.as_u16() == 301
            || status.as_u16() == 302
        {
            return Ok(());
        }
        if status.as_u16() == 409 {
            return Ok(());
        }
        Err(map_status(status, "Create remote folder"))
    }

    fn propfind(&self, url: &Url, depth: &str) -> AppResult<Vec<PropFindItem>> {
        let method = Method::from_bytes(b"PROPFIND").unwrap();
        let response = self
            .request(method, url)
            .header("Depth", depth)
            .body(PROPFIND_BODY)
            .send()
            .map_err(map_reqwest)?;
        let status = response.status();
        if status.as_u16() != 207 && !status.is_success() {
            return Err(map_status(status, "List remote folder"));
        }
        let xml = response.text().map_err(map_reqwest)?;
        parse_multistatus(&xml)
    }

    fn list_recursive(&self, url: &Url, out: &mut Vec<FileIdentity>) -> AppResult<()> {
        let items = self.propfind(url, "1")?;
        self.remember_collections_from(&items);
        for item in items {
            let Some(relative) = href_to_relative(&self.base, &item.href) else {
                continue;
            };
            if item.collection {
                if relative.is_empty() {
                    continue;
                }
                self.list_recursive(&join_remote(&self.base, &relative)?, out)?;
                continue;
            }
            if !is_syncable_relative(&relative) {
                continue;
            }
            out.push(FileIdentity {
                relative_path: relative,
                size: item.size,
                modified_ms: item.modified_ms,
                etag: item.etag,
                hash: None,
            });
        }
        Ok(())
    }

    fn ensure_base_collection(&self) -> AppResult<()> {
        match self.propfind(&self.base, "1") {
            Ok(items) => {
                self.remember_collections_from(&items);
                self.remember_collection("");
                Ok(())
            }
            Err(error) if error.code == ErrorCode::NotFound => {
                let mut built = self.base.clone();
                let segments = collection_segments(&self.base);
                built.set_path("/");
                for segment in segments {
                    {
                        let mut path = built.path().trim_end_matches('/').to_string();
                        path.push('/');
                        path.push_str(&segment);
                        path.push('/');
                        built.set_path(&path);
                    }
                    self.mkcol(&built)?;
                }
                let items = self.propfind(&self.base, "1")?;
                self.remember_collections_from(&items);
                self.remember_collection("");
                Ok(())
            }
            Err(error) => Err(error),
        }
    }

    fn list_with_infinity(&self) -> AppResult<Option<Vec<FileIdentity>>> {
        match self.propfind(&self.base, "infinity") {
            Ok(items) if infinity_listing_usable(&self.base, &items) => {
                *self
                    .session
                    .depth_mode
                    .lock()
                    .unwrap_or_else(|error| error.into_inner()) = DepthMode::Infinity;
                self.remember_collections_from(&items);
                Ok(Some(files_from_propfind(&self.base, &items)))
            }
            Ok(_) => {
                *self
                    .session
                    .depth_mode
                    .lock()
                    .unwrap_or_else(|error| error.into_inner()) = DepthMode::Depth1;
                Ok(None)
            }
            Err(error) if depth_infinity_unsupported(&error) => {
                *self
                    .session
                    .depth_mode
                    .lock()
                    .unwrap_or_else(|error| error.into_inner()) = DepthMode::Depth1;
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }
}

impl CloudProvider for WebDavProvider {
    fn id(&self) -> &'static str {
        "webdav"
    }

    fn probe(&self) -> AppResult<()> {
        self.ensure_base_collection()
    }

    fn list(&self) -> AppResult<Vec<FileIdentity>> {
        self.ensure_base_collection()?;
        self.session.listed.store(true, Ordering::Relaxed);
        let mode = *self
            .session
            .depth_mode
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if mode != DepthMode::Depth1 {
            if let Some(files) = self.list_with_infinity()? {
                return Ok(files);
            }
        }
        let mut files = Vec::new();
        self.list_recursive(&self.base, &mut files)?;
        Ok(files)
    }

    fn get(&self, relative_path: &str) -> AppResult<Vec<u8>> {
        let url = self.object_url(relative_path)?;
        let response = self
            .request(Method::GET, &url)
            .send()
            .map_err(map_reqwest)?;
        let status = response.status();
        if !status.is_success() {
            return Err(map_status(status, "Download remote file"));
        }
        response
            .bytes()
            .map(|bytes| bytes.to_vec())
            .map_err(map_reqwest)
    }

    fn put(&self, relative_path: &str, bytes: &[u8]) -> AppResult<FileIdentity> {
        if !self.session.listed.load(Ordering::Relaxed) {
            self.ensure_base_collection()?;
        }
        self.ensure_parents(relative_path)?;
        let url = self.object_url(relative_path)?;
        let response = self
            .client
            .put(url.clone())
            .basic_auth(&self.username, Some(&self.password))
            .header(CONTENT_TYPE, "application/octet-stream")
            .body(bytes.to_vec())
            .send()
            .map_err(map_reqwest)?;
        let status = response.status();
        if !status.is_success() {
            return Err(map_status(status, "Upload remote file"));
        }
        let etag = response
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string());
        let modified_ms = response
            .headers()
            .get(reqwest::header::LAST_MODIFIED)
            .and_then(|value| value.to_str().ok())
            .and_then(parse_http_date_ms)
            .unwrap_or_else(|| crate::domain::cloud_sync::now_ms() as u128);
        Ok(FileIdentity {
            relative_path: relative_path.to_string(),
            size: bytes.len() as u64,
            modified_ms,
            etag,
            hash: None,
        })
    }

    fn delete(&self, relative_path: &str) -> AppResult<()> {
        let url = self.object_url(relative_path)?;
        let response = self
            .request(Method::DELETE, &url)
            .send()
            .map_err(map_reqwest)?;
        let status = response.status();
        if status.is_success() || status.as_u16() == 404 {
            return Ok(());
        }
        Err(map_status(status, "Delete remote file"))
    }
}

pub(crate) fn parent_collection_prefixes(relative_path: &str) -> Vec<String> {
    let mut prefix = String::new();
    let mut out = Vec::new();
    let parts = relative_path.split('/').collect::<Vec<_>>();
    for (index, part) in parts.iter().enumerate() {
        if part.is_empty() || index + 1 == parts.len() {
            continue;
        }
        if !prefix.is_empty() {
            prefix.push('/');
        }
        prefix.push_str(part);
        out.push(prefix.clone());
    }
    out
}

fn files_from_propfind(base: &Url, items: &[PropFindItem]) -> Vec<FileIdentity> {
    let mut files = Vec::new();
    for item in items {
        if item.collection {
            continue;
        }
        let Some(relative) = href_to_relative(base, &item.href) else {
            continue;
        };
        if !is_syncable_relative(&relative) {
            continue;
        }
        files.push(FileIdentity {
            relative_path: relative,
            size: item.size,
            modified_ms: item.modified_ms,
            etag: item.etag.clone(),
            hash: None,
        });
    }
    files
}

fn infinity_listing_usable(base: &Url, items: &[PropFindItem]) -> bool {
    let mut has_child_collection = false;
    let mut has_nested_file = false;
    for item in items {
        let Some(relative) = href_to_relative(base, &item.href) else {
            continue;
        };
        if item.collection {
            if !relative.is_empty() {
                has_child_collection = true;
            }
        } else if relative.contains('/') {
            has_nested_file = true;
        }
    }
    has_nested_file || !has_child_collection
}

fn depth_infinity_unsupported(error: &AppError) -> bool {
    error.details.as_deref().is_some_and(|details| {
        details == "HTTP 400" || details == "HTTP 403" || details == "HTTP 501"
    })
}

pub fn parse_base_url(raw: &str, remote_prefix: &str) -> AppResult<Url> {
    let trimmed = raw.trim();
    let mut url = Url::parse(trimmed).map_err(|error| {
        AppError::invalid_path("WebDAV URL is invalid.").with_details(error.to_string())
    })?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(AppError::invalid_path(
            "WebDAV URL must start with http:// or https://.",
        ));
    }
    if url.cannot_be_a_base() {
        return Err(AppError::invalid_path("WebDAV URL is invalid."));
    }
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| AppError::invalid_path("WebDAV URL is invalid."))?;
        for segment in remote_prefix.split('/') {
            if segment.is_empty() {
                continue;
            }
            segments.push(segment);
        }
    }
    if !url.path().ends_with('/') {
        let path = format!("{}/", url.path());
        url.set_path(&path);
    }
    Ok(url)
}

pub fn join_remote(base: &Url, relative_path: &str) -> AppResult<Url> {
    let mut url = base.clone();
    if relative_path.trim().is_empty() {
        if !url.path().ends_with('/') {
            let path = format!("{}/", url.path());
            url.set_path(&path);
        }
        return Ok(url);
    }
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| AppError::invalid_path("WebDAV URL is invalid."))?;
        segments.pop_if_empty();
        for segment in relative_path.split('/') {
            if segment.is_empty() || segment == "." {
                continue;
            }
            if segment == ".." {
                return Err(AppError::invalid_path(
                    "Remote path must stay inside the sync folder.",
                ));
            }
            segments.push(segment);
        }
    }
    Ok(url)
}

pub fn href_to_relative(base: &Url, href: &str) -> Option<String> {
    let resolved = if href.starts_with("http://") || href.starts_with("https://") {
        Url::parse(href).ok()?
    } else {
        base.join(href).ok()?
    };
    let base_segments = decode_segments(base);
    let href_segments = decode_segments(&resolved);
    if href_segments.len() < base_segments.len() {
        return None;
    }
    if href_segments[..base_segments.len()] != base_segments[..] {
        return None;
    }
    let rest = href_segments[base_segments.len()..]
        .iter()
        .filter(|part| !part.is_empty())
        .cloned()
        .collect::<Vec<_>>();
    Some(rest.join("/"))
}

fn decode_segments(url: &Url) -> Vec<String> {
    url.path_segments()
        .map(|segments| {
            segments
                .filter(|part| !part.is_empty())
                .map(|part| percent_decode_str(part).decode_utf8_lossy().into_owned())
                .collect()
        })
        .unwrap_or_default()
}

fn collection_segments(url: &Url) -> Vec<String> {
    decode_segments(url)
}

fn parse_http_date_ms(value: &str) -> Option<u128> {
    httpdate::parse_http_date(value)
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
}

fn local_name(raw: &[u8]) -> String {
    let name = String::from_utf8_lossy(raw);
    name.rsplit([':', '}'])
        .next()
        .unwrap_or(name.as_ref())
        .to_string()
}

fn parse_multistatus(xml: &str) -> AppResult<Vec<PropFindItem>> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut items = Vec::new();
    let mut current: Option<PropFindItem> = None;
    let mut current_tag = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) => {
                let name = local_name(event.name().as_ref());
                if name.eq_ignore_ascii_case("response") {
                    current = Some(PropFindItem {
                        href: String::new(),
                        size: 0,
                        modified_ms: 0,
                        etag: None,
                        collection: false,
                    });
                } else if name.eq_ignore_ascii_case("collection") {
                    if let Some(item) = current.as_mut() {
                        item.collection = true;
                    }
                }
                current_tag = name;
            }
            Ok(Event::Empty(event)) => {
                let name = local_name(event.name().as_ref());
                if name.eq_ignore_ascii_case("collection") {
                    if let Some(item) = current.as_mut() {
                        item.collection = true;
                    }
                }
            }
            Ok(Event::Text(text)) => {
                let value = text.unescape().unwrap_or_default().into_owned();
                if let Some(item) = current.as_mut() {
                    if current_tag.eq_ignore_ascii_case("href") {
                        item.href = value;
                    } else if current_tag.eq_ignore_ascii_case("getcontentlength") {
                        item.size = value.parse().unwrap_or(0);
                    } else if current_tag.eq_ignore_ascii_case("getlastmodified") {
                        item.modified_ms = parse_http_date_ms(&value).unwrap_or(0);
                    } else if current_tag.eq_ignore_ascii_case("getetag") {
                        let trimmed = value.trim();
                        if !trimmed.is_empty() {
                            item.etag = Some(trimmed.to_string());
                        }
                    }
                }
            }
            Ok(Event::End(event)) => {
                let name = local_name(event.name().as_ref());
                if name.eq_ignore_ascii_case("response") {
                    if let Some(item) = current.take() {
                        if !item.href.is_empty() {
                            items.push(item);
                        }
                    }
                }
                current_tag.clear();
            }
            Ok(Event::Eof) => break,
            Err(error) => {
                return Err(AppError::serialization(error));
            }
            _ => {}
        }
        buf.clear();
    }
    Ok(items)
}

fn map_reqwest(error: reqwest::Error) -> AppError {
    AppError::new(ErrorCode::Io, "WebDAV request failed.").with_details(error.to_string())
}

fn map_status(status: reqwest::StatusCode, operation: &str) -> AppError {
    let code = match status.as_u16() {
        401 | 403 => ErrorCode::Io,
        404 => ErrorCode::NotFound,
        409 => ErrorCode::Conflict,
        _ => ErrorCode::Io,
    };
    let message = match status.as_u16() {
        401 | 403 => "Cloud provider rejected the credentials.".to_string(),
        404 => "Remote folder was not found.".to_string(),
        _ => format!("{operation} failed."),
    };
    AppError::new(code, message).with_details(format!("HTTP {}", status.as_u16()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_prefix_and_decodes_hrefs() {
        let base = parse_base_url("https://dav.example/dav", "Memoir/notes").unwrap();
        assert_eq!(base.as_str(), "https://dav.example/dav/Memoir/notes/");
        let file = join_remote(&base, "日记/today.md").unwrap();
        assert_eq!(
            href_to_relative(&base, file.as_str()).as_deref(),
            Some("日记/today.md")
        );
        assert_eq!(
            href_to_relative(&base, "/dav/Memoir/notes/%E6%97%A5%E8%AE%B0/today.md").as_deref(),
            Some("日记/today.md")
        );
        assert_eq!(
            href_to_relative(&base, "/dav/Memoir/notes/").as_deref(),
            Some("")
        );
        assert_eq!(href_to_relative(&base, "/other/today.md"), None);
    }

    #[test]
    fn parses_propfind_responses() {
        let xml = r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav/Memoir/notes/</d:href>
    <d:propstat>
      <d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/Memoir/notes/welcome.md</d:href>
    <d:propstat>
      <d:prop>
        <d:getcontentlength>12</d:getcontentlength>
        <d:getlastmodified>Wed, 21 Oct 2015 07:28:00 GMT</d:getlastmodified>
        <d:getetag>"abc"</d:getetag>
        <d:resourcetype/>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>"#;
        let items = parse_multistatus(xml).unwrap();
        assert_eq!(items.len(), 2);
        assert!(items[0].collection);
        assert_eq!(items[1].href, "/dav/Memoir/notes/welcome.md");
        assert_eq!(items[1].size, 12);
        assert_eq!(items[1].etag.as_deref(), Some("\"abc\""));
        assert!(items[1].modified_ms > 0);
    }

    #[test]
    fn rejects_non_http_urls_and_parent_segments() {
        assert!(parse_base_url("file:///tmp", "").is_err());
        let base = parse_base_url("https://dav.example/dav/", "").unwrap();
        assert!(join_remote(&base, "../secret.md").is_err());
    }

    #[test]
    fn lists_parent_prefixes_and_skips_known_collections() {
        assert_eq!(
            parent_collection_prefixes("attachments/2026-08/photo.png"),
            vec!["attachments".to_string(), "attachments/2026-08".to_string()]
        );
        assert!(parent_collection_prefixes("inbox.md").is_empty());
    }

    #[test]
    fn uses_infinity_only_when_nested_files_or_no_child_collections_appear() {
        let base = parse_base_url("https://dav.example/dav", "Memoir").unwrap();
        let shallow = parse_multistatus(
            r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav/Memoir/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/Memoir/attachments/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/Memoir/inbox.md</d:href>
    <d:propstat><d:prop><d:getcontentlength>1</d:getcontentlength></d:prop></d:propstat>
  </d:response>
</d:multistatus>"#,
        )
        .unwrap();
        assert!(!infinity_listing_usable(&base, &shallow));

        let deep = parse_multistatus(
            r#"<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav/Memoir/attachments/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/Memoir/attachments/2026-08/photo.png</d:href>
    <d:propstat>
      <d:prop>
        <d:getcontentlength>4</d:getcontentlength>
        <d:getetag>"p"</d:getetag>
      </d:prop>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/Memoir/%E6%97%A5%E8%AE%B0/today.md</d:href>
    <d:propstat><d:prop><d:getcontentlength>2</d:getcontentlength></d:prop></d:propstat>
  </d:response>
</d:multistatus>"#,
        )
        .unwrap();
        assert!(infinity_listing_usable(&base, &deep));
        let files = files_from_propfind(&base, &deep);
        assert!(files
            .iter()
            .any(|file| file.relative_path == "attachments/2026-08/photo.png"));
        assert!(files
            .iter()
            .any(|file| file.relative_path == "日记/today.md"));
    }

    #[test]
    fn treats_common_webdav_rejections_as_infinity_fallback() {
        let error =
            AppError::new(ErrorCode::Io, "List remote folder failed.").with_details("HTTP 403");
        assert!(depth_infinity_unsupported(&error));
        let other =
            AppError::new(ErrorCode::Io, "List remote folder failed.").with_details("HTTP 500");
        assert!(!depth_infinity_unsupported(&other));
    }
}
