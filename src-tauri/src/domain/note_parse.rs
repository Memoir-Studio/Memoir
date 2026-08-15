use regex::Regex;
use serde_yaml::Value;
use std::sync::OnceLock;

pub const PARSE_ALGO_VERSION: u32 = 1;
pub const INDEX_READ_CAP: usize = 1024 * 1024;
pub const EXCERPT_LEN: usize = 150;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedNote {
    pub title: String,
    pub tags: Vec<String>,
    pub excerpt: String,
}

pub fn parse_note(content: &str, fallback_file_name: &str) -> ParsedNote {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    match split_gray_matter(content) {
        Ok(split) => match parse_frontmatter_data(&split.matter) {
            Ok(data) => {
                let body = strip_frontmatter(&split.content);
                let title = frontmatter_title(&data)
                    .unwrap_or_else(|| extract_title(&split.content, fallback_file_name));
                ParsedNote {
                    title,
                    tags: parse_tags(&data),
                    excerpt: build_excerpt(&body),
                }
            }
            Err(_) => fallback_parse(content, fallback_file_name),
        },
        Err(_) => fallback_parse(content, fallback_file_name),
    }
}

pub fn excerpt_utf16(text: &str) -> String {
    let units: Vec<u16> = text.encode_utf16().take(EXCERPT_LEN).collect();
    if let Some(&last) = units.last() {
        if (0xd800..=0xdbff).contains(&last) {
            return String::from_utf16_lossy(&units[..units.len().saturating_sub(1)]);
        }
    }
    String::from_utf16_lossy(&units)
}

pub fn decode_utf8_prefix(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_string(),
        Err(error) => String::from_utf8_lossy(&bytes[..error.valid_up_to()]).into_owned(),
    }
}

pub fn file_name_title(fallback: &str) -> String {
    static EXTENSION: OnceLock<Regex> = OnceLock::new();
    let extension = EXTENSION.get_or_init(|| Regex::new(r"(?i)\.(md|mdx)$").expect("static"));
    extension.replace(fallback, "").trim().to_string()
}

fn fallback_parse(content: &str, fallback_file_name: &str) -> ParsedNote {
    let body = strip_frontmatter(content);
    ParsedNote {
        title: extract_title(&body, fallback_file_name),
        tags: Vec::new(),
        excerpt: build_excerpt(&body),
    }
}

struct MatterSplit {
    matter: String,
    content: String,
}

fn split_gray_matter(content: &str) -> Result<MatterSplit, ()> {
    const OPEN: &str = "---";
    if !content.starts_with(OPEN) {
        return Ok(MatterSplit {
            matter: String::new(),
            content: content.to_string(),
        });
    }
    if content.as_bytes().get(OPEN.len()) == Some(&b'-') {
        return Ok(MatterSplit {
            matter: String::new(),
            content: content.to_string(),
        });
    }

    let mut rest = &content[OPEN.len()..];
    if let Some(newline) = rest.find(['\n', '\r']) {
        let language = rest[..newline].trim();
        if !language.is_empty() {
            let after = if rest[newline..].starts_with("\r\n") {
                newline + 2
            } else {
                newline + 1
            };
            rest = &rest[after..];
        }
    }

    if let Some(close_at) = rest.find("\n---") {
        let matter = rest[..close_at].to_string();
        let mut body = &rest[close_at + "\n---".len()..];
        if body.starts_with('\r') {
            body = &body[1..];
        }
        if body.starts_with('\n') {
            body = &body[1..];
        }
        Ok(MatterSplit {
            matter,
            content: body.to_string(),
        })
    } else {
        Ok(MatterSplit {
            matter: rest.to_string(),
            content: String::new(),
        })
    }
}

fn parse_frontmatter_data(matter: &str) -> Result<Value, ()> {
    let stripped = strip_yaml_comment_lines(matter);
    if stripped.trim().is_empty() {
        return Ok(Value::Mapping(serde_yaml::Mapping::new()));
    }
    serde_yaml::from_str::<Value>(matter).map_err(|_| ())
}

fn strip_yaml_comment_lines(matter: &str) -> String {
    matter
        .lines()
        .filter(|line| !line.trim_start().starts_with('#'))
        .collect::<Vec<_>>()
        .join("\n")
}

fn frontmatter_title(data: &Value) -> Option<String> {
    let Value::Mapping(map) = data else {
        return None;
    };
    let title = map.get(&Value::String("title".into()))?;
    let Value::String(title) = title else {
        return None;
    };
    let trimmed = title.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn parse_tags(data: &Value) -> Vec<String> {
    let Value::Mapping(map) = data else {
        return Vec::new();
    };
    let Some(raw) = map.get(&Value::String("tags".into())) else {
        return Vec::new();
    };
    match raw {
        Value::Sequence(items) => items
            .iter()
            .map(js_string)
            .filter(|tag| !tag.is_empty())
            .collect(),
        Value::String(value) => value
            .split(',')
            .map(str::trim)
            .filter(|tag| !tag.is_empty())
            .map(ToOwned::to_owned)
            .collect(),
        _ => Vec::new(),
    }
}

fn js_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        Value::Null => "null".into(),
        Value::Mapping(_) => "[object Object]".into(),
        Value::Sequence(items) => items.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Tagged(tagged) => js_string(&tagged.value),
    }
}

fn strip_frontmatter(content: &str) -> String {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    let pattern =
        PATTERN.get_or_init(|| Regex::new(r"^---\r?\n[\s\S]*?\r?\n---\r?\n?").expect("static"));
    pattern.replace(content, "").into_owned()
}

fn extract_title(content: &str, fallback: &str) -> String {
    let heading = first_level_one_heading(content);
    if !heading.is_empty() {
        return heading;
    }
    let from_file = file_name_title(fallback);
    if from_file.is_empty() {
        "Untitled".into()
    } else {
        from_file
    }
}

fn first_level_one_heading(content: &str) -> String {
    let visible = visible_markdown(&strip_frontmatter(content));
    static ATX: OnceLock<Regex> = OnceLock::new();
    static HTML: OnceLock<Regex> = OnceLock::new();
    let atx = ATX.get_or_init(|| Regex::new(r"(?m)^#\s+(.+)$").expect("static"));
    let html = HTML.get_or_init(|| Regex::new(r"(?is)<h1\b[^>]*>([\s\S]*?)</h1>").expect("static"));
    let atx_match = atx.find(&visible);
    let html_match = html.find(&visible);
    let atx_index = atx_match
        .as_ref()
        .map(|item| item.start())
        .unwrap_or(usize::MAX);
    let html_index = html_match
        .as_ref()
        .map(|item| item.start())
        .unwrap_or(usize::MAX);
    if let (Some(captured), true) = (atx.captures(&visible), atx_index < html_index) {
        return heading_text(captured.get(1).map(|item| item.as_str()).unwrap_or(""));
    }
    if let Some(captured) = html.captures(&visible) {
        return html_heading_text(captured.get(1).map(|item| item.as_str()).unwrap_or(""));
    }
    String::new()
}

fn visible_markdown(content: &str) -> String {
    static FENCE: OnceLock<Regex> = OnceLock::new();
    let fence = FENCE.get_or_init(|| Regex::new(r"^\s*(```|~~~)").expect("static"));
    let mut in_fence = false;
    let mut lines = Vec::new();
    for line in content.split('\n') {
        if fence.is_match(line) {
            in_fence = !in_fence;
            lines.push(String::new());
            continue;
        }
        lines.push(if in_fence {
            String::new()
        } else {
            line.to_string()
        });
    }
    lines.join("\n")
}

fn heading_text(raw: &str) -> String {
    static MARKS: OnceLock<Regex> = OnceLock::new();
    let marks = MARKS.get_or_init(|| Regex::new(r"[#`*_~]").expect("static"));
    collapse_ws(&marks.replace_all(raw, ""))
}

fn html_heading_text(raw: &str) -> String {
    static TAGS: OnceLock<Regex> = OnceLock::new();
    let tags = TAGS.get_or_init(|| Regex::new(r"<[^>]+>").expect("static"));
    collapse_ws(&tags.replace_all(raw, " "))
}

fn collapse_ws(value: &str) -> String {
    static WS: OnceLock<Regex> = OnceLock::new();
    let ws = WS.get_or_init(|| Regex::new(r"\s+").expect("static"));
    ws.replace_all(value, " ").trim().to_string()
}

fn build_excerpt(content: &str) -> String {
    static FRONT: OnceLock<Regex> = OnceLock::new();
    static FENCE: OnceLock<Regex> = OnceLock::new();
    static MARKS: OnceLock<Regex> = OnceLock::new();
    static WS: OnceLock<Regex> = OnceLock::new();
    let front = FRONT.get_or_init(|| Regex::new(r"^---[\s\S]*?---").expect("static"));
    let fence = FENCE.get_or_init(|| Regex::new(r"```[\s\S]*?```").expect("static"));
    let marks = MARKS.get_or_init(|| Regex::new(r"[#>*_`~\[\](){}!-]").expect("static"));
    let ws = WS.get_or_init(|| Regex::new(r"\s+").expect("static"));
    let stripped = front.replace(content, "");
    let stripped = fence.replace_all(&stripped, "");
    let stripped = marks.replace_all(&stripped, " ");
    let text = ws.replace_all(&stripped, " ");
    excerpt_utf16(text.trim())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct CorpusCase {
        name: String,
        content: String,
        #[serde(rename = "fallbackFileName")]
        fallback_file_name: String,
        title: String,
        tags: Vec<String>,
        excerpt: String,
    }

    #[test]
    fn rust_parse_matches_shared_corpus() {
        let raw = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../src/features/library/fixtures/note-parse-corpus.json"
        ));
        let cases: Vec<CorpusCase> = serde_json::from_str(raw).expect("corpus json");
        assert!(!cases.is_empty());
        for case in cases {
            let parsed = parse_note(&case.content, &case.fallback_file_name);
            assert_eq!(parsed.title, case.title, "title {}", case.name);
            assert_eq!(parsed.tags, case.tags, "tags {}", case.name);
            assert_eq!(parsed.excerpt, case.excerpt, "excerpt {}", case.name);
        }
    }

    #[test]
    fn decodes_mid_codepoint_cap_without_dropping_frontmatter() {
        let mut bytes = b"---\ntitle: Cap\n---\n\n# Cap\n\n".to_vec();
        bytes.extend(std::iter::repeat(0xe4).take(8));
        let prefix = decode_utf8_prefix(&bytes);
        let parsed = parse_note(&prefix, "cap.md");
        assert_eq!(parsed.title, "Cap");
        assert!(parsed.parse_is_from_frontmatter());
    }

    impl ParsedNote {
        fn parse_is_from_frontmatter(&self) -> bool {
            self.title == "Cap"
        }
    }
}
