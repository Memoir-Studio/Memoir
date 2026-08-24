import {
  fallbackLinkPreview,
  parseLinkPreviewHtml,
  type LinkPreview,
} from "../../domain/link-preview";
import { getGateways } from "../../gateways";

const previewCache = new Map<string, LinkPreview>();
const inflight = new Map<string, Promise<LinkPreview>>();
const MAX_CACHE = 80;

export function getCachedLinkPreview(url: string) {
  return previewCache.get(url);
}

export function resetLinkPreviewCache() {
  previewCache.clear();
  inflight.clear();
}

export function loadLinkPreview(url: string, label = ""): Promise<LinkPreview> {
  const cached = previewCache.get(url);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(url);
  if (pending) return pending;

  const request = (async () => {
    const fallback = fallbackLinkPreview(url, label);
    try {
      const html = await getGateways().workspace.fetchLinkPreviewHtml(url);
      const parsed = parseLinkPreviewHtml(html, url);
      const preview: LinkPreview = {
        url,
        title: parsed.title || fallback.title,
        description: parsed.description,
        image: parsed.image,
        siteName: parsed.siteName || fallback.siteName,
        favicon: parsed.favicon || fallback.favicon,
      };
      rememberPreview(url, preview);
      return preview;
    } catch {
      rememberPreview(url, fallback);
      return fallback;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, request);
  return request;
}

function rememberPreview(url: string, preview: LinkPreview) {
  if (previewCache.size >= MAX_CACHE && !previewCache.has(url)) {
    const oldest = previewCache.keys().next().value;
    if (oldest) previewCache.delete(oldest);
  }
  previewCache.set(url, preview);
}
