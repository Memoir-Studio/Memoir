import GithubSlugger from "github-slugger";
import matter from "gray-matter";
import {
  normalizeTag,
  type HeadingItem,
  type NoteMeta,
  type NavFilter,
  type ScopedFilter,
} from "../../domain/notes";

export { addUniqueTags, normalizeTag, parseTagTokens } from "../../domain/notes";

export function stripFrontmatter(content: string) {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function fileNameTitle(fallback: string) {
  return fallback.replace(/\.(md|mdx)$/i, "").trim();
}

function frontmatterTitle(data: Record<string, unknown>) {
  const title = data.title;
  return typeof title === "string" ? title.trim() : "";
}

function headingText(raw: string) {
  return raw.replace(/[#`*_~]/g, "").replace(/\s+/g, " ").trim();
}

function htmlHeadingText(raw: string) {
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function visibleMarkdown(content: string) {
  let inFence = false;
  const lines: string[] = [];
  for (const line of content.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      lines.push("");
      continue;
    }
    lines.push(inFence ? "" : line);
  }
  return lines.join("\n");
}

function firstLevelOneHeading(content: string) {
  const visible = visibleMarkdown(stripFrontmatter(content));
  const atx = /^#\s+(.+)$/m.exec(visible);
  const html = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(visible);
  const atxIndex = atx?.index ?? Number.POSITIVE_INFINITY;
  const htmlIndex = html?.index ?? Number.POSITIVE_INFINITY;
  if (atx && atxIndex < htmlIndex) return headingText(atx[1]);
  if (html) return htmlHeadingText(html[1]);
  return "";
}

export function extractTitle(content: string, fallback: string) {
  return firstLevelOneHeading(content) || fileNameTitle(fallback) || "Untitled";
}

export function buildExcerpt(content: string) {
  return content
    .replace(/^---[\s\S]*?---/, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#>*_`~[\](){}!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

export function parseNote(content: string, fallbackTitle: string) {
  try {
    const parsed = matter(content);
    const body = stripFrontmatter(parsed.content);
    const title = frontmatterTitle(parsed.data) || extractTitle(parsed.content, fallbackTitle);
    const rawTags = parsed.data.tags;
    const tags = Array.isArray(rawTags)
      ? rawTags.map(String).filter(Boolean)
      : typeof rawTags === "string"
        ? rawTags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
        : [];

    return { body, title, tags, excerpt: buildExcerpt(body) };
  } catch {
    const body = stripFrontmatter(content);
    return {
      body,
      title: extractTitle(body, fallbackTitle),
      tags: [],
      excerpt: buildExcerpt(body),
    };
  }
}

export function countWords(content: string) {
  const cjk = content.match(/[\u4e00-\u9fff]/g)?.length || 0;
  const latin = content.match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g)?.length || 0;
  return cjk + latin;
}

export function folderName(relativePath: string) {
  if (!relativePath.includes("/")) return "";
  return relativePath.slice(0, relativePath.lastIndexOf("/"));
}

export function isRootFolder(name: string) {
  return name === "";
}

export function uniqueSorted(values: string[], locales?: string | string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, locales));
}

export function extractHeadings(content: string): HeadingItem[] {
  const slugger = new GithubSlugger();
  const headings: HeadingItem[] = [];
  let inFence = false;

  for (const line of content.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (!match) continue;
    const text = match[2].replace(/[#`*_~]/g, "").trim();
    if (!text) continue;
    headings.push({ id: slugger.slug(text), depth: match[1].length, text });
  }

  return headings;
}

export function filterNotes(
  notes: NoteMeta[],
  query: string,
  navFilter: NavFilter,
  scopedFilter: ScopedFilter,
  now = Date.now(),
) {
  const normalizedQuery = query.trim().toLowerCase();
  return notes.filter((note) => {
    if (navFilter === "recent" && now - note.modifiedMs > 7 * 86_400_000) return false;
    if (navFilter === "favorites" && !note.favorite) return false;
    if (navFilter === "uncategorized" && note.tags.length > 0) return false;
    if (scopedFilter?.type === "folder" && folderName(note.relativePath) !== scopedFilter.value) {
      return false;
    }
    if (
      scopedFilter?.type === "tag" &&
      !note.tags.some((tag) => normalizeTag(tag) === normalizeTag(scopedFilter.value))
    ) {
      return false;
    }
    if (!normalizedQuery) return true;
    return [note.title, note.excerpt, note.relativePath, ...note.tags]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
}

export function noteStats(content: string) {
  const words = countWords(content);
  return {
    words,
    chars: content.length,
    minutes: Math.max(1, Math.ceil(words / 260)),
  };
}
