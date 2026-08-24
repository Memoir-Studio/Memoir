use crate::domain::folder_of;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NoteLinkKind {
    Wiki,
    Markdown,
}

impl NoteLinkKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Wiki => "wiki",
            Self::Markdown => "markdown",
        }
    }

    pub fn parse(value: &str) -> Self {
        if value.eq_ignore_ascii_case("markdown") {
            Self::Markdown
        } else {
            Self::Wiki
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawNoteLink {
    pub target_ref: String,
    pub heading: String,
    pub display_text: String,
    pub kind: NoteLinkKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoteLinkIdentity {
    pub relative_path: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteGraphNode {
    pub relative_path: String,
    pub title: String,
    pub folder: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteGraphEdge {
    pub source_path: String,
    pub target_path: Option<String>,
    pub target_ref: String,
    pub display_text: String,
    pub heading: String,
    pub kind: NoteLinkKind,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct NoteGraph {
    pub nodes: Vec<NoteGraphNode>,
    pub edges: Vec<NoteGraphEdge>,
}

pub fn extract_note_links(content: &str) -> Vec<RawNoteLink> {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let stripped = strip_frontmatter(content);
    let visible = strip_inline_code(&visible_markdown(&stripped));
    let visible = wiki_embed_re().replace_all(&visible, " ");
    let visible = md_image_re().replace_all(&visible, " ");

    let mut links = Vec::new();
    let mut seen = HashSet::new();

    for captured in wiki_re().captures_iter(&visible) {
        let Some(full) = captured.get(0) else {
            continue;
        };
        if full.start() > 0 && visible.as_bytes().get(full.start() - 1) == Some(&b'!') {
            continue;
        }
        if let Some(parsed) =
            parse_wiki_inner(captured.get(1).map(|item| item.as_str()).unwrap_or(""))
        {
            if remember_link(&mut seen, &parsed) {
                links.push(parsed);
            }
        }
    }

    for captured in md_link_re().captures_iter(&visible) {
        let Some(full) = captured.get(0) else {
            continue;
        };
        if full.start() > 0 && visible.as_bytes().get(full.start() - 1) == Some(&b'!') {
            continue;
        }
        let label = captured.get(1).map(|item| item.as_str()).unwrap_or("");
        let href = captured.get(2).map(|item| item.as_str()).unwrap_or("");
        if let Some(parsed) = parse_markdown_link(label, href) {
            if remember_link(&mut seen, &parsed) {
                links.push(parsed);
            }
        }
    }

    links
}

pub fn resolve_note_ref(
    target_ref: &str,
    source_path: &str,
    notes: &[NoteLinkIdentity],
) -> Option<String> {
    let normalized = normalize_target_ref(target_ref);
    if normalized.is_empty() {
        return None;
    }

    let mut by_path: HashMap<String, String> = HashMap::new();
    let mut by_stem: HashMap<String, Vec<String>> = HashMap::new();
    let mut by_title: HashMap<String, Vec<String>> = HashMap::new();
    for note in notes {
        let path = note.relative_path.replace('\\', "/");
        by_path.insert(path.to_ascii_lowercase(), path.clone());
        let without_ext = strip_note_ext(&path);
        by_path.insert(without_ext.to_ascii_lowercase(), path.clone());
        push_index(
            &mut by_stem,
            note_stem(&path).to_ascii_lowercase(),
            path.clone(),
        );
        let title = note.title.trim().to_ascii_lowercase();
        if !title.is_empty() {
            push_index(&mut by_title, title, path);
        }
    }

    let source_dir = folder_of(source_path);
    let looks_like_path = normalized.contains('/')
        || normalized == "."
        || normalized.starts_with("./")
        || normalized.starts_with("..")
        || has_note_ext(&normalized);

    if looks_like_path {
        let relative = join_relative(&source_dir, &normalized);
        if let Some(found) = match_path(&relative, &by_path) {
            return Some(found);
        }
        let from_root = normalized.trim_start_matches("./");
        if let Some(found) = match_path(from_root, &by_path) {
            return Some(found);
        }
    }

    if let Some(found) = match_path(&normalized, &by_path) {
        return Some(found);
    }
    if let Some(found) = pick_unique(by_stem.get(&normalized.to_ascii_lowercase()), &source_dir) {
        return Some(found);
    }
    pick_unique(by_title.get(&normalized.to_ascii_lowercase()), &source_dir)
}

fn parse_wiki_inner(inner: &str) -> Option<RawNoteLink> {
    let trimmed = inner.trim();
    if trimmed.is_empty() {
        return None;
    }
    let (target_part, alias) = match trimmed.split_once('|') {
        Some((target, alias)) => (target.trim(), alias.trim()),
        None => (trimmed, ""),
    };
    let (path, heading) = split_hash(target_part);
    let target_ref = normalize_target_ref(&path);
    if target_ref.is_empty() || is_media_ref(&target_ref) {
        return None;
    }
    let display_text = if alias.is_empty() {
        display_from_ref(&target_ref, &heading)
    } else {
        alias.to_string()
    };
    Some(RawNoteLink {
        target_ref,
        heading,
        display_text,
        kind: NoteLinkKind::Wiki,
    })
}

fn parse_markdown_link(label: &str, href: &str) -> Option<RawNoteLink> {
    let raw = href.trim().trim_start_matches('<').trim_end_matches('>');
    if !is_note_markdown_href(raw) {
        return None;
    }
    let decoded = percent_decode(raw);
    let (path, heading) = split_hash(&decoded);
    let target_ref = normalize_target_ref(&path);
    if target_ref.is_empty() {
        return None;
    }
    let display_text = {
        let label = label.trim();
        if label.is_empty() {
            display_from_ref(&target_ref, &heading)
        } else {
            label.to_string()
        }
    };
    Some(RawNoteLink {
        target_ref,
        heading,
        display_text,
        kind: NoteLinkKind::Markdown,
    })
}

fn is_note_markdown_href(href: &str) -> bool {
    let path = split_hash(&percent_decode(href)).0.replace('\\', "/");
    if path.is_empty() || is_external_href(href) || is_media_ref(&path) {
        return false;
    }
    has_note_ext(&path)
}

fn remember_link(seen: &mut HashSet<String>, link: &RawNoteLink) -> bool {
    let key = format!(
        "{}\0{}\0{}",
        link.kind.as_str(),
        link.target_ref,
        link.heading
    );
    seen.insert(key)
}

fn strip_frontmatter(content: &str) -> String {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    let pattern =
        PATTERN.get_or_init(|| Regex::new(r"^---\r?\n[\s\S]*?\r?\n---\r?\n?").expect("static"));
    pattern.replace(content, "").into_owned()
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

fn strip_inline_code(content: &str) -> String {
    let chars: Vec<char> = content.chars().collect();
    let mut out = String::with_capacity(content.len());
    let mut index = 0;
    while index < chars.len() {
        if chars[index] != '`' {
            out.push(chars[index]);
            index += 1;
            continue;
        }
        let mut ticks = 0;
        while index + ticks < chars.len() && chars[index + ticks] == '`' {
            ticks += 1;
        }
        let mut cursor = index + ticks;
        let mut end = chars.len();
        while cursor < chars.len() {
            if chars[cursor] != '`' {
                cursor += 1;
                continue;
            }
            let mut close = 0;
            while cursor + close < chars.len() && chars[cursor + close] == '`' {
                close += 1;
            }
            if close == ticks {
                end = cursor + close;
                break;
            }
            cursor += close;
        }
        for _ in index..end {
            out.push(' ');
        }
        index = end;
    }
    out
}

fn split_hash(value: &str) -> (String, String) {
    let trimmed = value.trim();
    match trimmed.split_once('#') {
        Some((path, heading)) => (path.trim().to_string(), heading.trim().to_string()),
        None => (trimmed.to_string(), String::new()),
    }
}

fn normalize_target_ref(value: &str) -> String {
    value
        .replace('\\', "/")
        .trim()
        .trim_start_matches("./")
        .trim_end_matches('/')
        .to_string()
}

fn display_from_ref(target_ref: &str, heading: &str) -> String {
    let name = note_stem(target_ref.rsplit('/').next().unwrap_or(target_ref));
    if heading.is_empty() {
        name
    } else {
        format!("{name}#{heading}")
    }
}

fn is_external_href(href: &str) -> bool {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    let pattern = PATTERN.get_or_init(|| {
        Regex::new(r"^(https?:|mailto:|data:|javascript:|ftp:|tel:|#)").expect("static")
    });
    pattern.is_match(href.trim())
}

fn is_media_ref(path: &str) -> bool {
    static MEDIA: OnceLock<Regex> = OnceLock::new();
    static ATTACH: OnceLock<Regex> = OnceLock::new();
    let media = MEDIA.get_or_init(|| {
        Regex::new(r"(?i)\.(png|jpe?g|gif|webp|bmp|avif|svg|ico|pdf)$").expect("static")
    });
    let attach = ATTACH.get_or_init(|| Regex::new(r"(?i)(^|/)attachments/").expect("static"));
    let clean = split_hash(path).0;
    media.is_match(&clean) || attach.is_match(&clean)
}

fn has_note_ext(path: &str) -> bool {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    let pattern = PATTERN.get_or_init(|| Regex::new(r"(?i)\.(md|mdx)$").expect("static"));
    pattern.is_match(path)
}

fn strip_note_ext(path: &str) -> String {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    let pattern = PATTERN.get_or_init(|| Regex::new(r"(?i)\.(md|mdx)$").expect("static"));
    pattern.replace(path, "").into_owned()
}

fn note_stem(path: &str) -> String {
    strip_note_ext(path.rsplit('/').next().unwrap_or(path))
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = &value[index + 1..index + 3];
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn push_index(map: &mut HashMap<String, Vec<String>>, key: String, path: String) {
    let list = map.entry(key).or_default();
    if !list.iter().any(|item| item == &path) {
        list.push(path);
    }
}

fn match_path(candidate: &str, by_path: &HashMap<String, String>) -> Option<String> {
    if let Some(found) = by_path.get(&candidate.to_ascii_lowercase()) {
        return Some(found.clone());
    }
    if has_note_ext(candidate) {
        return None;
    }
    by_path
        .get(&format!("{candidate}.md").to_ascii_lowercase())
        .or_else(|| by_path.get(&format!("{candidate}.mdx").to_ascii_lowercase()))
        .cloned()
}

fn join_relative(source_dir: &str, target: &str) -> String {
    let mut parts: Vec<String> = if source_dir.is_empty() {
        Vec::new()
    } else {
        source_dir
            .split('/')
            .filter(|part| !part.is_empty())
            .map(ToOwned::to_owned)
            .collect()
    };
    for part in target.replace('\\', "/").split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." {
            parts.pop();
            continue;
        }
        parts.push(part.to_string());
    }
    parts.join("/")
}

fn pick_unique(candidates: Option<&Vec<String>>, source_dir: &str) -> Option<String> {
    let candidates = candidates?;
    if candidates.len() == 1 {
        return candidates.first().cloned();
    }
    if candidates.is_empty() {
        return None;
    }
    let same_folder: Vec<&String> = candidates
        .iter()
        .filter(|path| folder_of(path) == source_dir)
        .collect();
    let pool: Vec<&String> = if same_folder.len() == 1 {
        return Some(same_folder[0].clone());
    } else if !same_folder.is_empty() {
        same_folder
    } else {
        candidates.iter().collect()
    };
    let shortest = pool.iter().map(|path| path.len()).min()?;
    let short: Vec<&&String> = pool.iter().filter(|path| path.len() == shortest).collect();
    if short.len() == 1 {
        Some((*short[0]).clone())
    } else {
        None
    }
}

fn wiki_re() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"\[\[([^\[\]]+)\]\]").expect("static"))
}

fn md_link_re() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"\[([^\]]*)\]\(([^)]+)\)").expect("static"))
}

fn md_image_re() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"!\[[^\]]*\]\([^)]+\)").expect("static"))
}

fn wiki_embed_re() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r"!\[\[[^\[\]]+\]\]").expect("static"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct ExtractCase {
        name: String,
        content: String,
        links: Vec<RawNoteLink>,
    }

    #[derive(Deserialize)]
    struct ResolveNote {
        #[serde(rename = "relativePath")]
        relative_path: String,
        title: String,
    }

    #[derive(Deserialize)]
    struct ResolveCase {
        name: String,
        #[serde(rename = "sourcePath")]
        source_path: String,
        #[serde(rename = "targetRef")]
        target_ref: String,
        notes: Vec<ResolveNote>,
        resolved: Option<String>,
    }

    #[derive(Deserialize)]
    struct Corpus {
        extract: Vec<ExtractCase>,
        resolve: Vec<ResolveCase>,
    }

    fn load_corpus() -> Corpus {
        let raw = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../src/features/library/fixtures/note-links-corpus.json"
        ));
        serde_json::from_str(raw).expect("corpus json")
    }

    #[test]
    fn extract_matches_shared_corpus() {
        let corpus = load_corpus();
        assert!(!corpus.extract.is_empty());
        for case in corpus.extract {
            assert_eq!(
                extract_note_links(&case.content),
                case.links,
                "extract {}",
                case.name
            );
        }
    }

    #[test]
    fn resolve_matches_shared_corpus() {
        let corpus = load_corpus();
        assert!(!corpus.resolve.is_empty());
        for case in corpus.resolve {
            let notes = case
                .notes
                .iter()
                .map(|note| NoteLinkIdentity {
                    relative_path: note.relative_path.clone(),
                    title: note.title.clone(),
                })
                .collect::<Vec<_>>();
            assert_eq!(
                resolve_note_ref(&case.target_ref, &case.source_path, &notes),
                case.resolved,
                "resolve {}",
                case.name
            );
        }
    }
}
