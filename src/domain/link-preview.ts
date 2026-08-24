export const LINK_PREVIEW_HTML_LIMIT = 256 * 1024;

export type LinkPreview = {
  url: string;
  title: string;
  description: string;
  image: string;
  siteName: string;
  favicon: string;
};

export function isPreviewableHttpUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function hostnameOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

export function fallbackLinkPreview(url: string, label = ""): LinkPreview {
  const host = hostnameOf(url);
  const trimmed = label.trim();
  return {
    url,
    title: trimmed && trimmed !== url ? trimmed : host,
    description: "",
    image: "",
    siteName: host,
    favicon: faviconFromPageUrl(url),
  };
}

export function parseLinkPreviewHtml(html: string, pageUrl: string): LinkPreview {
  const fallback = fallbackLinkPreview(pageUrl);
  const head = extractHead(html);
  const title =
    metaContent(head, "og:title") ||
    metaContent(head, "twitter:title") ||
    titleTag(head) ||
    fallback.title;
  const description =
    metaContent(head, "og:description") ||
    metaContent(head, "twitter:description") ||
    namedMetaContent(head, "description");
  const image =
    metaContent(head, "og:image:secure_url") ||
    metaContent(head, "og:image") ||
    metaContent(head, "twitter:image") ||
    metaContent(head, "twitter:image:src");
  const siteName = metaContent(head, "og:site_name") || fallback.siteName;
  const icon = iconHref(head);
  return {
    url: pageUrl,
    title: decodeEntities(title) || fallback.title,
    description: decodeEntities(description),
    image: resolveUrl(image, pageUrl),
    siteName: decodeEntities(siteName) || fallback.siteName,
    favicon: resolveUrl(icon, pageUrl) || fallback.favicon,
  };
}

function extractHead(html: string) {
  const start = html.search(/<head\b/i);
  if (start < 0) return html.slice(0, 80_000);
  const fromHead = html.slice(start);
  const end = fromHead.search(/<\/head>/i);
  return end >= 0 ? fromHead.slice(0, end) : fromHead.slice(0, 80_000);
}

function titleTag(html: string) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, " ").trim() || "";
}

function metaContent(html: string, key: string) {
  const expected = key.toLowerCase();
  for (const tag of tags(html, "meta")) {
    const property = (attr(tag, "property") || attr(tag, "name")).toLowerCase();
    if (property === expected) return attr(tag, "content");
  }
  return "";
}

function namedMetaContent(html: string, key: string) {
  const expected = key.toLowerCase();
  for (const tag of tags(html, "meta")) {
    if (attr(tag, "name").toLowerCase() === expected) return attr(tag, "content");
  }
  return "";
}

function iconHref(html: string) {
  let fallback = "";
  for (const tag of tags(html, "link")) {
    const rel = attr(tag, "rel").toLowerCase();
    if (!rel.includes("icon")) continue;
    const href = attr(tag, "href");
    if (!href) continue;
    if (rel.includes("apple-touch-icon")) return href;
    if (!fallback || rel === "icon" || rel.includes("shortcut")) fallback = href;
  }
  return fallback;
}

function tags(html: string, name: string) {
  return html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) || [];
}

function attr(tag: string, name: string) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(["'])([^"']*)\\1`, "i"));
  return match?.[2]?.trim() || "";
}

function resolveUrl(value: string, pageUrl: string) {
  const href = value.trim();
  if (!href) return "";
  try {
    return new URL(href, pageUrl).href;
  } catch {
    return "";
  }
}

function faviconFromPageUrl(url: string) {
  try {
    return new URL("/favicon.ico", new URL(url).origin).href;
  } catch {
    return "";
  }
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => codePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => codePoint(Number.parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function codePoint(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  try {
    return String.fromCodePoint(value);
  } catch {
    return "";
  }
}


