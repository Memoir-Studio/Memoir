use super::CloudProvider;
use crate::domain::{
    cloud_sync::{
        is_syncable_relative, now_ms, sanitize_remote_prefix, CloudSyncProfile, FileIdentity,
    },
    AppError, AppResult, ErrorCode,
};
use hmac::{Hmac, Mac};
use quick_xml::{events::Event, Reader};
use reqwest::{
    blocking::{Client, RequestBuilder},
    header::{HeaderName, HeaderValue, ETAG, LAST_MODIFIED},
    Method, StatusCode,
};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use url::Url;

type HmacSha256 = Hmac<Sha256>;

const SERVICE: &str = "s3";
const AWS4_REQUEST: &str = "aws4_request";
const LIST_PAGE_SIZE: usize = 1_000;

/// An S3 Signature V4 provider. It talks to AWS S3 when no endpoint is
/// supplied, and to S3-compatible storage when an endpoint is configured.
#[derive(Debug, Clone)]
pub struct S3Provider {
    client: Client,
    bucket_base: Url,
    base: Url,
    key_prefix: String,
    region: String,
    access_key_id: String,
    secret_access_key: String,
    session_token: Option<String>,
}

#[derive(Debug, Default)]
struct ListPage {
    files: Vec<FileIdentity>,
    next_token: Option<String>,
}

impl S3Provider {
    pub fn from_profile(profile: &CloudSyncProfile) -> AppResult<Self> {
        let prefix = sanitize_remote_prefix(&profile.remote_prefix)?;
        let bucket_base = parse_base_url(
            &profile.s3.endpoint,
            &profile.s3.region,
            &profile.s3.bucket,
            "",
            profile.s3.force_path_style,
        )?;
        let base = parse_base_url(
            &profile.s3.endpoint,
            &profile.s3.region,
            &profile.s3.bucket,
            &prefix,
            profile.s3.force_path_style,
        )?;
        let client = Client::builder()
            .timeout(Duration::from_secs(300))
            .connect_timeout(Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .danger_accept_invalid_certs(profile.s3.insecure_tls)
            .user_agent("Memoir/0.1")
            .build()
            .map_err(|error| {
                AppError::new(ErrorCode::Io, "Unable to create the S3 client.")
                    .with_details(error.to_string())
            })?;
        Ok(Self {
            client,
            bucket_base,
            base,
            key_prefix: (!prefix.is_empty())
                .then(|| format!("{prefix}/"))
                .unwrap_or_default(),
            region: profile.s3.region.clone(),
            access_key_id: profile.s3.access_key_id.clone(),
            secret_access_key: profile.s3.secret_access_key.clone(),
            session_token: (!profile.s3.session_token.trim().is_empty())
                .then(|| profile.s3.session_token.clone()),
        })
    }

    fn object_url(&self, relative_path: &str) -> AppResult<Url> {
        join_object_url(&self.base, relative_path)
    }

    fn request(
        &self,
        method: Method,
        url: Url,
        query: &[(String, String)],
        payload: &[u8],
        content_type: Option<&str>,
    ) -> AppResult<RequestBuilder> {
        let timestamp = signing_timestamp(SystemTime::now());
        let payload_hash = sha256_hex(payload);
        let mut headers = BTreeMap::new();
        headers.insert("host".into(), host_header(&url)?);
        headers.insert("x-amz-content-sha256".into(), payload_hash.clone());
        headers.insert("x-amz-date".into(), timestamp.amz_date.clone());
        if let Some(token) = &self.session_token {
            headers.insert("x-amz-security-token".into(), token.clone());
        }
        if let Some(content_type) = content_type {
            headers.insert("content-type".into(), content_type.into());
        }
        let authorization = authorization_header(
            method.as_str(),
            &url,
            query,
            &headers,
            &payload_hash,
            &timestamp,
            &self.region,
            &self.access_key_id,
            &self.secret_access_key,
        )?;

        let mut request = self.client.request(method, url);
        for (name, value) in headers {
            let name = HeaderName::from_bytes(name.as_bytes()).map_err(|error| {
                AppError::new(ErrorCode::Io, "Unable to sign S3 request.")
                    .with_details(error.to_string())
            })?;
            let value = HeaderValue::from_str(&value).map_err(|error| {
                AppError::new(ErrorCode::Io, "Unable to sign S3 request.")
                    .with_details(error.to_string())
            })?;
            request = request.header(name, value);
        }
        Ok(request
            .header("Authorization", authorization)
            .body(payload.to_vec()))
    }

    fn list_page(&self, continuation_token: Option<&str>) -> AppResult<ListPage> {
        let query = list_query(&self.key_prefix, continuation_token);
        let url = url_with_query(self.bucket_base.clone(), &query)?;
        let request = self.request(Method::GET, url, &query, &[], None)?;
        let response = request.send().map_err(map_reqwest)?;
        let status = response.status();
        if !status.is_success() {
            return Err(map_status(status, "List S3 objects"));
        }
        let xml = response.text().map_err(map_reqwest)?;
        parse_list_objects_v2(&xml)
    }
}

impl CloudProvider for S3Provider {
    fn id(&self) -> &'static str {
        "s3"
    }

    fn probe(&self) -> AppResult<()> {
        self.list_page(None).map(|_| ())
    }

    fn list(&self) -> AppResult<Vec<FileIdentity>> {
        self.list_with_progress(&|_| {})
    }

    fn list_with_progress(
        &self,
        on_progress: &(dyn Fn(&str) + Send + Sync),
    ) -> AppResult<Vec<FileIdentity>> {
        let mut files = Vec::new();
        let mut token: Option<String> = None;
        loop {
            on_progress("");
            let page = self.list_page(token.as_deref())?;
            files.extend(
                page.files
                    .into_iter()
                    .filter_map(|file| remote_key_to_relative(file, &self.key_prefix))
                    .filter(|file| is_syncable_relative(&file.relative_path)),
            );
            let Some(next) = page.next_token else {
                break;
            };
            if token.as_deref() == Some(next.as_str()) {
                return Err(AppError::new(
                    ErrorCode::Io,
                    "S3 listing returned a repeated continuation token.",
                ));
            }
            token = Some(next);
        }
        Ok(files)
    }

    fn get(&self, relative_path: &str) -> AppResult<Vec<u8>> {
        let url = self.object_url(relative_path)?;
        let request = self.request(Method::GET, url, &[], &[], None)?;
        let response = request.send().map_err(map_reqwest)?;
        let status = response.status();
        if !status.is_success() {
            return Err(map_status(status, "Download S3 object"));
        }
        response
            .bytes()
            .map(|bytes| bytes.to_vec())
            .map_err(map_reqwest)
    }

    fn put(&self, relative_path: &str, bytes: &[u8]) -> AppResult<FileIdentity> {
        let url = self.object_url(relative_path)?;
        let request = self.request(
            Method::PUT,
            url,
            &[],
            bytes,
            Some("application/octet-stream"),
        )?;
        let response = request.send().map_err(map_reqwest)?;
        let status = response.status();
        if !status.is_success() {
            return Err(map_status(status, "Upload S3 object"));
        }
        let etag = response
            .headers()
            .get(ETAG)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let modified_ms = response
            .headers()
            .get(LAST_MODIFIED)
            .and_then(|value| value.to_str().ok())
            .and_then(parse_http_date_ms)
            .unwrap_or_else(|| now_ms() as u128);
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
        let request = self.request(Method::DELETE, url, &[], &[], None)?;
        let response = request.send().map_err(map_reqwest)?;
        let status = response.status();
        if status.is_success() || status == StatusCode::NOT_FOUND {
            return Ok(());
        }
        Err(map_status(status, "Delete S3 object"))
    }
}

pub fn parse_base_url(
    endpoint: &str,
    region: &str,
    bucket: &str,
    remote_prefix: &str,
    force_path_style: bool,
) -> AppResult<Url> {
    let endpoint = endpoint.trim();
    let region = region.trim();
    let bucket = bucket.trim();
    if region.is_empty() {
        return Err(AppError::invalid_path("S3 region is required."));
    }
    if bucket.is_empty() {
        return Err(AppError::invalid_path("S3 bucket is required."));
    }
    let raw = if endpoint.is_empty() {
        format!("https://s3.{region}.amazonaws.com")
    } else {
        endpoint.to_string()
    };
    let mut url = Url::parse(&raw).map_err(|error| {
        AppError::invalid_path("S3 endpoint is invalid.").with_details(error.to_string())
    })?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(AppError::invalid_path(
            "S3 endpoint must start with http:// or https://.",
        ));
    }
    if url.cannot_be_a_base() || url.host_str().is_none() {
        return Err(AppError::invalid_path("S3 endpoint is invalid."));
    }
    url.set_query(None);
    url.set_fragment(None);
    if force_path_style {
        push_segments(
            &mut url,
            std::iter::once(bucket).chain(remote_prefix.split('/')),
        )?;
    } else {
        let host = url.host_str().unwrap_or_default();
        url.set_host(Some(&format!("{bucket}.{host}")))
            .map_err(|_| {
                AppError::invalid_path("S3 bucket cannot be used in a virtual-host endpoint.")
            })?;
        push_segments(&mut url, remote_prefix.split('/'))?;
    }
    ensure_trailing_slash(&mut url);
    Ok(url)
}

fn join_object_url(base: &Url, relative_path: &str) -> AppResult<Url> {
    let mut url = base.clone();
    if relative_path.trim().is_empty() {
        return Ok(url);
    }
    if relative_path.split('/').any(|segment| segment == "..") {
        return Err(AppError::invalid_path(
            "Remote path must stay inside the sync folder.",
        ));
    }
    push_segments(&mut url, relative_path.split('/'))?;
    Ok(url)
}

fn push_segments<'a>(url: &mut Url, segments: impl IntoIterator<Item = &'a str>) -> AppResult<()> {
    let mut path = url
        .path_segments_mut()
        .map_err(|_| AppError::invalid_path("S3 endpoint is invalid."))?;
    path.pop_if_empty();
    for segment in segments {
        if !segment.is_empty() && segment != "." {
            path.push(segment);
        }
    }
    Ok(())
}

fn ensure_trailing_slash(url: &mut Url) {
    if !url.path().ends_with('/') {
        let path = format!("{}/", url.path());
        url.set_path(&path);
    }
}

fn list_query(prefix: &str, continuation_token: Option<&str>) -> Vec<(String, String)> {
    let mut query = vec![
        ("list-type".into(), "2".into()),
        ("max-keys".into(), LIST_PAGE_SIZE.to_string()),
    ];
    if !prefix.is_empty() {
        query.push(("prefix".into(), prefix.into()));
    }
    if let Some(token) = continuation_token.filter(|token| !token.is_empty()) {
        query.push(("continuation-token".into(), token.into()));
    }
    query
}

fn remote_key_to_relative(mut file: FileIdentity, prefix: &str) -> Option<FileIdentity> {
    if !file.relative_path.starts_with(prefix) {
        return None;
    }
    file.relative_path = file.relative_path[prefix.len()..].to_string();
    (!file.relative_path.is_empty()).then_some(file)
}

fn url_with_query(mut url: Url, query: &[(String, String)]) -> AppResult<Url> {
    let canonical = canonical_query(query);
    url.set_query((!canonical.is_empty()).then_some(&canonical));
    Ok(url)
}

#[derive(Debug, Clone)]
struct SigningTimestamp {
    short_date: String,
    amz_date: String,
}

fn signing_timestamp(time: SystemTime) -> SigningTimestamp {
    let seconds = time
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = day_seconds / 3_600;
    let minute = (day_seconds % 3_600) / 60;
    let second = day_seconds % 60;
    SigningTimestamp {
        short_date: format!("{year:04}{month:02}{day:02}"),
        amz_date: format!("{year:04}{month:02}{day:02}T{hour:02}{minute:02}{second:02}Z"),
    }
}

#[allow(clippy::too_many_arguments)]
fn authorization_header(
    method: &str,
    url: &Url,
    query: &[(String, String)],
    headers: &BTreeMap<String, String>,
    payload_hash: &str,
    timestamp: &SigningTimestamp,
    region: &str,
    access_key_id: &str,
    secret_access_key: &str,
) -> AppResult<String> {
    let canonical_headers = headers
        .iter()
        .map(|(name, value)| format!("{name}:{}\n", normalize_header_value(value)))
        .collect::<String>();
    let signed_headers = headers.keys().cloned().collect::<Vec<_>>().join(";");
    let canonical_request = format!(
        "{method}\n{}\n{}\n{canonical_headers}\n{signed_headers}\n{payload_hash}",
        canonical_uri(url),
        canonical_query(query),
    );
    let scope = format!(
        "{}/{}/{SERVICE}/{AWS4_REQUEST}",
        timestamp.short_date, region
    );
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{scope}\n{}",
        timestamp.amz_date,
        sha256_hex(canonical_request.as_bytes()),
    );
    let signing_key = signing_key(secret_access_key, &timestamp.short_date, region)?;
    let signature = hex_encode(&hmac(&signing_key, &string_to_sign)?);
    Ok(format!(
        "AWS4-HMAC-SHA256 Credential={access_key_id}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
    ))
}

fn signing_key(secret: &str, date: &str, region: &str) -> AppResult<Vec<u8>> {
    let date_key = hmac(format!("AWS4{secret}").as_bytes(), date)?;
    let region_key = hmac(&date_key, region)?;
    let service_key = hmac(&region_key, SERVICE)?;
    hmac(&service_key, AWS4_REQUEST)
}

fn hmac(key: &[u8], message: &str) -> AppResult<Vec<u8>> {
    let mut mac = HmacSha256::new_from_slice(key).map_err(|error| {
        AppError::new(ErrorCode::Io, "Unable to sign S3 request.").with_details(error.to_string())
    })?;
    mac.update(message.as_bytes());
    Ok(mac.finalize().into_bytes().to_vec())
}

fn canonical_uri(url: &Url) -> String {
    let path = url.path();
    if path.is_empty() {
        "/".into()
    } else {
        path.split('/')
            .map(|segment| canonical_path_segment(segment))
            .collect::<Vec<_>>()
            .join("/")
    }
}

fn canonical_path_segment(segment: &str) -> String {
    let bytes = percent_decode(segment);
    percent_encode(&bytes)
}

fn canonical_query(query: &[(String, String)]) -> String {
    let mut pairs = query
        .iter()
        .map(|(key, value)| {
            (
                percent_encode(key.as_bytes()),
                percent_encode(value.as_bytes()),
            )
        })
        .collect::<Vec<_>>();
    pairs.sort();
    pairs
        .into_iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&")
}

fn percent_encode(bytes: &[u8]) -> String {
    let mut out = String::new();
    for byte in bytes {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn percent_decode(value: &str) -> Vec<u8> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) =
                (hex_value(bytes[index + 1]), hex_value(bytes[index + 2]))
            {
                out.push((high << 4) | low);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    out
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn normalize_header_value(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn host_header(url: &Url) -> AppResult<String> {
    let host = url
        .host_str()
        .ok_or_else(|| AppError::invalid_path("S3 endpoint is invalid."))?;
    Ok(match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    })
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex_encode(&Sha256::digest(bytes))
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn parse_list_objects_v2(xml: &str) -> AppResult<ListPage> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buffer = Vec::new();
    let mut page = ListPage::default();
    let mut current: Option<FileIdentity> = None;
    let mut tag = String::new();
    let mut in_contents = false;

    loop {
        match reader.read_event_into(&mut buffer) {
            Ok(Event::Start(event)) => {
                let name = local_name(event.name().as_ref());
                if name == "Contents" {
                    in_contents = true;
                    current = Some(FileIdentity {
                        relative_path: String::new(),
                        size: 0,
                        modified_ms: 0,
                        etag: None,
                        hash: None,
                    });
                }
                tag = name;
            }
            Ok(Event::Text(text)) => {
                let value = text.unescape().unwrap_or_default().into_owned();
                if in_contents {
                    if let Some(file) = current.as_mut() {
                        match tag.as_str() {
                            "Key" => file.relative_path = value,
                            "Size" => file.size = value.parse().unwrap_or(0),
                            "LastModified" => {
                                file.modified_ms = parse_s3_timestamp_ms(&value).unwrap_or(0)
                            }
                            "ETag" => {
                                let value = value.trim();
                                if !value.is_empty() {
                                    file.etag = Some(value.to_string());
                                }
                            }
                            _ => {}
                        }
                    }
                } else if tag == "NextContinuationToken" {
                    let value = value.trim();
                    if !value.is_empty() {
                        page.next_token = Some(value.to_string());
                    }
                }
            }
            Ok(Event::End(event)) => {
                let name = local_name(event.name().as_ref());
                if name == "Contents" {
                    in_contents = false;
                    if let Some(file) = current.take().filter(|file| !file.relative_path.is_empty())
                    {
                        page.files.push(file);
                    }
                }
                tag.clear();
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(AppError::serialization(error)),
            _ => {}
        }
        buffer.clear();
    }
    Ok(page)
}

fn local_name(raw: &[u8]) -> String {
    let name = String::from_utf8_lossy(raw);
    name.rsplit([':', '}'])
        .next()
        .unwrap_or(name.as_ref())
        .to_string()
}

fn parse_s3_timestamp_ms(value: &str) -> Option<u128> {
    let value = value.trim();
    let date = value.get(0..10)?;
    let time = value.get(11..19)?;
    let mut date_parts = date.split('-').map(|part| part.parse::<i64>().ok());
    let year = date_parts.next()??;
    let month = date_parts.next()??;
    let day = date_parts.next()??;
    let mut time_parts = time.split(':').map(|part| part.parse::<i64>().ok());
    let hour = time_parts.next()??;
    let minute = time_parts.next()??;
    let second = time_parts.next()??;
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    let fraction = value
        .get(19..)
        .and_then(|tail| tail.strip_prefix('.'))
        .and_then(|tail| tail.split(['Z', '+', '-']).next())
        .unwrap_or("");
    let millis = fraction
        .chars()
        .take(3)
        .collect::<String>()
        .parse::<u128>()
        .ok()
        .map(|value| value * 10_u128.pow(3_u32.saturating_sub(fraction.len().min(3) as u32)))
        .unwrap_or(0);
    let days = days_from_civil(year, month, day);
    Some(((days * 86_400 + hour * 3_600 + minute * 60 + second) as u128) * 1_000 + millis)
}

fn parse_http_date_ms(value: &str) -> Option<u128> {
    httpdate::parse_http_date(value)
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let days = days + 719_468;
    let era = if days >= 0 { days } else { days - 146_096 } / 146_097;
    let day_of_era = days - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

fn days_from_civil(mut year: i64, month: i64, day: i64) -> i64 {
    year -= i64::from(month <= 2);
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn map_reqwest(error: reqwest::Error) -> AppError {
    AppError::new(ErrorCode::Io, "S3 request failed.").with_details(error.to_string())
}

fn map_status(status: StatusCode, operation: &str) -> AppError {
    let code = match status.as_u16() {
        404 => ErrorCode::NotFound,
        409 => ErrorCode::Conflict,
        _ => ErrorCode::Io,
    };
    let message = match status.as_u16() {
        401 | 403 => "Cloud provider rejected the credentials.".to_string(),
        404 => "S3 bucket or object was not found.".to_string(),
        _ => format!("{operation} failed."),
    };
    AppError::new(code, message).with_details(format!("HTTP {}", status.as_u16()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_aws_virtual_host_and_compatible_path_style_urls() {
        let aws =
            parse_base_url("", "ap-southeast-1", "memoir-notes", "Memoir/notes", false).unwrap();
        assert_eq!(
            aws.as_str(),
            "https://memoir-notes.s3.ap-southeast-1.amazonaws.com/Memoir/notes/"
        );
        let minio = parse_base_url(
            "https://minio.example:9000/api",
            "us-east-1",
            "memoir",
            "notes",
            true,
        )
        .unwrap();
        assert_eq!(
            minio.as_str(),
            "https://minio.example:9000/api/memoir/notes/"
        );
        assert_eq!(
            join_object_url(&minio, "日记/today.md").unwrap().as_str(),
            "https://minio.example:9000/api/memoir/notes/%E6%97%A5%E8%AE%B0/today.md"
        );
    }

    #[test]
    fn canonicalizes_query_and_matches_aws_signature_example() {
        assert_eq!(
            canonical_query(&[
                ("prefix".into(), "a b".into()),
                ("list-type".into(), "2".into())
            ]),
            "list-type=2&prefix=a%20b"
        );
        let url = Url::parse("https://examplebucket.s3.amazonaws.com/test.txt").unwrap();
        let mut headers = BTreeMap::new();
        headers.insert("host".into(), "examplebucket.s3.amazonaws.com".into());
        headers.insert("range".into(), "bytes=0-9".into());
        headers.insert(
            "x-amz-content-sha256".into(),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".into(),
        );
        headers.insert("x-amz-date".into(), "20130524T000000Z".into());
        let timestamp = SigningTimestamp {
            short_date: "20130524".into(),
            amz_date: "20130524T000000Z".into(),
        };
        let authorization = authorization_header(
            "GET",
            &url,
            &[],
            &headers,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            &timestamp,
            "us-east-1",
            "AKIAIOSFODNN7EXAMPLE",
            "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        )
        .unwrap();
        assert_eq!(
            authorization,
            "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
        );
    }

    #[test]
    fn parses_paginated_list_objects_response() {
        let page = parse_list_objects_v2(
            r#"<?xml version="1.0"?><ListBucketResult>
              <Contents><Key>journal/today.md</Key><LastModified>2026-08-25T12:34:56.120Z</LastModified><ETag>"abc"</ETag><Size>12</Size></Contents>
              <Contents><Key>.memoir/index.sqlite</Key><Size>9</Size></Contents>
              <NextContinuationToken>next+/=</NextContinuationToken>
            </ListBucketResult>"#,
        )
        .unwrap();
        assert_eq!(page.files.len(), 2);
        assert_eq!(page.files[0].relative_path, "journal/today.md");
        assert_eq!(page.files[0].etag.as_deref(), Some("\"abc\""));
        assert!(page.files[0].modified_ms > 0);
        assert_eq!(page.next_token.as_deref(), Some("next+/="));
    }

    #[test]
    fn lists_only_objects_inside_the_configured_remote_prefix() {
        let query = list_query("Memoir/notes/", Some("next+/="));
        assert_eq!(
            canonical_query(&query),
            "continuation-token=next%2B%2F%3D&list-type=2&max-keys=1000&prefix=Memoir%2Fnotes%2F"
        );
        let inside = remote_key_to_relative(
            FileIdentity {
                relative_path: "Memoir/notes/journal/today.md".into(),
                size: 1,
                modified_ms: 1,
                etag: None,
                hash: None,
            },
            "Memoir/notes/",
        )
        .unwrap();
        assert_eq!(inside.relative_path, "journal/today.md");
        assert!(remote_key_to_relative(
            FileIdentity {
                relative_path: "other/workspace.md".into(),
                size: 1,
                modified_ms: 1,
                etag: None,
                hash: None,
            },
            "Memoir/notes/",
        )
        .is_none());
    }

    #[test]
    fn formats_and_parses_utc_dates() {
        let timestamp = signing_timestamp(UNIX_EPOCH + Duration::from_secs(1_700_000_000));
        assert_eq!(timestamp.amz_date, "20231114T221320Z");
        assert_eq!(
            parse_s3_timestamp_ms("2023-11-14T22:13:20.12Z"),
            Some(1_700_000_000_120)
        );
    }
}
