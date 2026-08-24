import { decodeMediaHref, noteDirectory, resolveWorkspaceFilePath } from "./paths";

export type NoteLinkKind = "wiki" | "markdown";

export type ExtractedNoteLink = {
  targetRef: string;
  heading: string;
  displayText: string;
  kind: NoteLinkKind;
};

export type NoteLinkIdentity = {
  relativePath: string;
  title: string;
};

export type NoteGraphNode = {
  relativePath: string;
  title: string;
  folder: string;
};

export type NoteGraphEdge = {
  sourcePath: string;
  targetPath: string | null;
  targetRef: string;
  displayText: string;
  heading: string;
  kind: NoteLinkKind;
};

export type NoteGraph = {
  nodes: NoteGraphNode[];
  edges: NoteGraphEdge[];
};

export type NoteLinkItem = {
  sourcePath: string;
  sourceTitle: string;
  targetPath: string | null;
  targetTitle: string | null;
  targetRef: string;
  displayText: string;
  heading: string;
  kind: NoteLinkKind;
};

export type NoteRefs = {
  outgoing: NoteLinkItem[];
  incoming: NoteLinkItem[];
  unresolved: NoteLinkItem[];
};

const MEDIA_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|svg|ico|pdf)$/i;
const NOTE_EXT = /\.(md|mdx)$/i;
const WIKI_RE = /\[\[([^\[\]]+)\]\]/g;
const MD_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
const MD_IMAGE_RE = /!\[[^\]]*\]\([^)]+\)/g;
const WIKI_EMBED_RE = /!\[\[[^\[\]]+\]\]/g;

export function folderOf(relativePath: string) {
  return noteDirectory(relativePath);
}

export function noteStem(relativePath: string) {
  const fileName = relativePath.split("/").pop() || relativePath;
  return fileName.replace(NOTE_EXT, "");
}

export function extractNoteLinks(content: string): ExtractedNoteLink[] {
  const visible = stripInlineCode(visibleMarkdown(stripFrontmatter(content)))
    .replace(WIKI_EMBED_RE, " ")
    .replace(MD_IMAGE_RE, " ");
  const links: ExtractedNoteLink[] = [];
  const seen = new Set<string>();

  WIKI_RE.lastIndex = 0;
  for (const match of visible.matchAll(WIKI_RE)) {
    const index = match.index ?? 0;
    if (index > 0 && visible[index - 1] === "!") continue;
    const parsed = parseWikiInner(match[1] || "");
    if (!parsed || !rememberLink(seen, parsed)) continue;
    links.push(parsed);
  }

  MD_LINK_RE.lastIndex = 0;
  for (const match of visible.matchAll(MD_LINK_RE)) {
    const index = match.index ?? 0;
    if (index > 0 && visible[index - 1] === "!") continue;
    const parsed = parseMarkdownLink(match[1] || "", match[2] || "");
    if (!parsed || !rememberLink(seen, parsed)) continue;
    links.push(parsed);
  }

  return links;
}

export function resolveNoteRef(
  targetRef: string,
  sourcePath: string,
  notes: NoteLinkIdentity[],
): string | undefined {
  const normalized = normalizeTargetRef(targetRef);
  if (!normalized) return undefined;

  const byPath = new Map<string, string>();
  const byStem = new Map<string, string[]>();
  const byTitle = new Map<string, string[]>();
  for (const note of notes) {
    const path = note.relativePath.replace(/\\/g, "/");
    byPath.set(path.toLowerCase(), path);
    const withoutExt = path.replace(NOTE_EXT, "");
    byPath.set(withoutExt.toLowerCase(), path);
    pushIndex(byStem, noteStem(path).toLowerCase(), path);
    const title = note.title.trim().toLowerCase();
    if (title) pushIndex(byTitle, title, path);
  }

  const sourceDir = folderOf(sourcePath);
  const looksLikePath = normalized.includes("/") || /^\.\.?(?:\/|$)/.test(normalized) || NOTE_EXT.test(normalized);

  if (looksLikePath) {
    const relative = joinRelative(sourceDir, normalized);
    const fromRelative = matchPath(relative, byPath);
    if (fromRelative) return fromRelative;
    const fromRoot = matchPath(normalized.replace(/^\.\//, ""), byPath);
    if (fromRoot) return fromRoot;
  }

  const exact = matchPath(normalized, byPath);
  if (exact) return exact;

  const stemHit = pickUnique(byStem.get(normalized.toLowerCase()) || [], sourceDir);
  if (stemHit) return stemHit;

  const titleHit = pickUnique(byTitle.get(normalized.toLowerCase()) || [], sourceDir);
  if (titleHit) return titleHit;

  return undefined;
}

export function buildNoteGraph(
  notes: Array<{ relativePath: string; title: string; content: string }>,
): NoteGraph {
  const identities = notes.map((note) => ({
    relativePath: note.relativePath.replace(/\\/g, "/"),
    title: note.title,
  }));
  const nodes = identities.map((note) => ({
    relativePath: note.relativePath,
    title: note.title,
    folder: folderOf(note.relativePath),
  }));
  const edges: NoteGraphEdge[] = [];
  const seen = new Set<string>();
  for (const note of notes) {
    const sourcePath = note.relativePath.replace(/\\/g, "/");
    for (const link of extractNoteLinks(note.content)) {
      const targetPath = resolveNoteRef(link.targetRef, sourcePath, identities) ?? null;
      const key = `${sourcePath}\0${targetPath ?? ""}\0${link.targetRef}\0${link.kind}\0${link.heading}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        sourcePath,
        targetPath,
        targetRef: link.targetRef,
        displayText: link.displayText,
        heading: link.heading,
        kind: link.kind,
      });
    }
  }
  return { nodes, edges };
}

export function noteRefsFromGraph(
  graph: NoteGraph,
  relativePath: string,
  liveOutgoing?: ExtractedNoteLink[],
): NoteRefs {
  const path = relativePath.replace(/\\/g, "/");
  const titles = new Map(graph.nodes.map((node) => [node.relativePath, node.title]));
  const sourceTitle = titles.get(path) || noteStem(path);
  const outgoingSource =
    liveOutgoing ??
    graph.edges
      .filter((edge) => edge.sourcePath === path)
      .map((edge) => ({
        targetRef: edge.targetRef,
        heading: edge.heading,
        displayText: edge.displayText,
        kind: edge.kind,
      }));
  const identities = graph.nodes.map((node) => ({
    relativePath: node.relativePath,
    title: node.title,
  }));
  const outgoing: NoteLinkItem[] = outgoingSource.map((link) => {
    const targetPath = resolveNoteRef(link.targetRef, path, identities) ?? null;
    return {
      sourcePath: path,
      sourceTitle,
      targetPath,
      targetTitle: targetPath ? titles.get(targetPath) || null : null,
      targetRef: link.targetRef,
      displayText: link.displayText,
      heading: link.heading,
      kind: link.kind,
    };
  });
  const incoming = graph.edges
    .filter((edge) => edge.targetPath === path && edge.sourcePath !== path)
    .map((edge) => ({
      sourcePath: edge.sourcePath,
      sourceTitle: titles.get(edge.sourcePath) || noteStem(edge.sourcePath),
      targetPath: path,
      targetTitle: sourceTitle,
      targetRef: edge.targetRef,
      displayText: edge.displayText,
      heading: edge.heading,
      kind: edge.kind,
    }));
  return {
    outgoing,
    incoming,
    unresolved: outgoing.filter((item) => !item.targetPath),
  };
}

export function isNoteMarkdownHref(href: string) {
  const path = stripHash(decodeMediaHref(href)).replace(/\\/g, "/");
  if (!path || isExternalHref(href) || isMediaRef(path)) return false;
  return NOTE_EXT.test(path);
}

export function splitHash(value: string): { path: string; heading: string } {
  const trimmed = value.trim();
  const hash = trimmed.indexOf("#");
  if (hash < 0) return { path: trimmed, heading: "" };
  return {
    path: trimmed.slice(0, hash).trim(),
    heading: trimmed.slice(hash + 1).trim(),
  };
}

function parseWikiInner(inner: string): ExtractedNoteLink | null {
  const trimmed = inner.trim();
  if (!trimmed) return null;
  const pipe = trimmed.indexOf("|");
  const targetPart = (pipe < 0 ? trimmed : trimmed.slice(0, pipe)).trim();
  const alias = (pipe < 0 ? "" : trimmed.slice(pipe + 1)).trim();
  const { path, heading } = splitHash(targetPart);
  const targetRef = normalizeTargetRef(path);
  if (!targetRef || isMediaRef(targetRef)) return null;
  return {
    targetRef,
    heading,
    displayText: alias || displayFromRef(targetRef, heading),
    kind: "wiki",
  };
}

function parseMarkdownLink(label: string, href: string): ExtractedNoteLink | null {
  const raw = href.trim().replace(/^<|>$/g, "");
  if (!isNoteMarkdownHref(raw)) return null;
  const { path, heading } = splitHash(decodeMediaHref(raw));
  const targetRef = normalizeTargetRef(path);
  if (!targetRef) return null;
  const display = label.trim() || displayFromRef(targetRef, heading);
  return {
    targetRef,
    heading,
    displayText: display,
    kind: "markdown",
  };
}

function rememberLink(seen: Set<string>, link: ExtractedNoteLink) {
  const key = `${link.kind}\0${link.targetRef}\0${link.heading}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

function stripFrontmatter(content: string) {
  return content.replace(/^\uFEFF/, "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
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

function stripInlineCode(content: string) {
  const chars = [...content];
  const out: string[] = [];
  let index = 0;
  while (index < chars.length) {
    if (chars[index] !== "`") {
      out.push(chars[index]);
      index += 1;
      continue;
    }
    let ticks = 0;
    while (index + ticks < chars.length && chars[index + ticks] === "`") ticks += 1;
    let cursor = index + ticks;
    let end = chars.length;
    while (cursor < chars.length) {
      if (chars[cursor] !== "`") {
        cursor += 1;
        continue;
      }
      let close = 0;
      while (cursor + close < chars.length && chars[cursor + close] === "`") close += 1;
      if (close === ticks) {
        end = cursor + close;
        break;
      }
      cursor += close;
    }
    for (let fill = index; fill < end; fill += 1) out.push(" ");
    index = end;
  }
  return out.join("");
}

function normalizeTargetRef(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "").trim();
}

function displayFromRef(targetRef: string, heading: string) {
  const name = noteStem(targetRef.split("/").pop() || targetRef);
  return heading ? `${name}#${heading}` : name;
}

function isExternalHref(href: string) {
  return /^(https?:|mailto:|data:|javascript:|ftp:|tel:|#)/i.test(href.trim());
}

function isMediaRef(path: string) {
  const clean = stripHash(path);
  return MEDIA_EXT.test(clean) || /(^|\/)attachments\//i.test(clean);
}

function stripHash(value: string) {
  const hash = value.indexOf("#");
  return (hash < 0 ? value : value.slice(0, hash)).trim();
}

function pushIndex(map: Map<string, string[]>, key: string, path: string) {
  const list = map.get(key);
  if (list) {
    if (!list.includes(path)) list.push(path);
  } else {
    map.set(key, [path]);
  }
}

function matchPath(candidate: string, byPath: Map<string, string>) {
  const direct = byPath.get(candidate.toLowerCase());
  if (direct) return direct;
  if (NOTE_EXT.test(candidate)) return undefined;
  return byPath.get(`${candidate}.md`.toLowerCase()) || byPath.get(`${candidate}.mdx`.toLowerCase());
}

function joinRelative(sourceDir: string, target: string) {
  const joined = resolveWorkspaceFilePath(sourceDir || ".", target).replace(/\\/g, "/");
  return joined.replace(/^\.\//, "").replace(/^\/+/, "");
}

function pickUnique(candidates: string[], sourceDir: string) {
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) return undefined;
  const sameFolder = candidates.filter((path) => folderOf(path) === sourceDir);
  if (sameFolder.length === 1) return sameFolder[0];
  const pool = sameFolder.length ? sameFolder : candidates;
  const shortest = Math.min(...pool.map((path) => path.length));
  const short = pool.filter((path) => path.length === shortest);
  return short.length === 1 ? short[0] : undefined;
}
