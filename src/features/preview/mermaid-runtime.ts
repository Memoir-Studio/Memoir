export function mermaidSourceKey(code: string) {
  return `${getMermaidTheme()}:${code}`;
}

const svgCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
const MAX_CACHE = 40;
let mermaidInitialized = false;
let mermaidTheme = "";
let idSeq = 0;

export function getMermaidTheme() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "default";
}

export function getCachedMermaidSvg(code: string) {
  return svgCache.get(mermaidSourceKey(code));
}

function rememberSvg(code: string, svg: string) {
  const key = mermaidSourceKey(code);
  if (svgCache.size >= MAX_CACHE && !svgCache.has(key)) {
    const oldest = svgCache.keys().next().value;
    if (oldest) svgCache.delete(oldest);
  }
  svgCache.set(key, svg);
}

export async function renderMermaidDiagram(code: string) {
  const key = mermaidSourceKey(code);
  const cached = svgCache.get(key);
  if (cached) return cached;
  const pending = inflight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const { default: mermaid } = await import("mermaid");
    const theme = getMermaidTheme();
    if (!mermaidInitialized || mermaidTheme !== theme) {
      mermaid.initialize({ startOnLoad: false, theme, securityLevel: "strict" });
      mermaidInitialized = true;
      mermaidTheme = theme;
    }
    idSeq += 1;
    const result = await mermaid.render(`memoir-mmd-${idSeq}`, code);
    rememberSvg(code, result.svg);
    return result.svg;
  })().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, request);
  return request;
}

export function resetMermaidRuntime() {
  svgCache.clear();
  inflight.clear();
  mermaidInitialized = false;
  mermaidTheme = "";
  idSeq = 0;
}
