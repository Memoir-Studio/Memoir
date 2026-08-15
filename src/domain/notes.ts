export type NoteExtension = "md" | "mdx";

export type RawNoteFile = {
  relativePath: string;
  fileName: string;
  extension: NoteExtension;
  modifiedMs: number;
  size: number;
  title: string;
  tags: string[];
  excerpt: string;
};

export type NoteMeta = RawNoteFile & {
  favorite: boolean;
  dirty?: boolean;
};

export type HeadingItem = {
  id: string;
  depth: number;
  text: string;
};

export type NavFilter = "all" | "recent" | "favorites" | "uncategorized";

export type ScopedFilter =
  | { type: "folder"; value: string }
  | { type: "tag"; value: string }
  | null;

export function normalizeTag(tag: string) {
  return tag.trim().toLowerCase();
}

export function parseTagTokens(raw: string) {
  return raw
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function addUniqueTags(current: string[], incoming: string[]) {
  const next = [...current];
  const seen = new Set(current.map(normalizeTag));
  for (const tag of incoming) {
    const trimmed = tag.trim();
    const key = normalizeTag(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(trimmed);
  }
  return next;
}
