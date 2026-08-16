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

export type LibraryQuery = {
  q: string;
  nav: NavFilter;
  folder: string | null;
  tag: string | null;
  favoritePaths?: string[] | null;
  nowMs?: number;
};

export type FolderStat = {
  folder: string;
  count: number;
};

export type TagStat = {
  tag: string;
  tagNorm: string;
  count: number;
};

export type LibraryStats = {
  total: number;
  recent: number;
  favorites: number;
  uncategorized: number;
  folders: FolderStat[];
  tags: TagStat[];
  truncated: boolean;
};

export type LibraryPage = {
  notes: RawNoteFile[];
  stats: LibraryStats;
};

export type RenamedNote = {
  oldPath: string;
  note: RawNoteFile;
};

export function emptyLibraryStats(): LibraryStats {
  return {
    total: 0,
    recent: 0,
    favorites: 0,
    uncategorized: 0,
    folders: [],
    tags: [],
    truncated: false,
  };
}

export function libraryQueryFromFilters(
  query: string,
  navFilter: NavFilter,
  scopedFilter: ScopedFilter,
  favoritePaths: string[] = [],
  nowMs = Date.now(),
): LibraryQuery {
  return {
    q: query,
    nav: navFilter,
    folder: scopedFilter?.type === "folder" ? scopedFilter.value : null,
    tag: scopedFilter?.type === "tag" ? scopedFilter.value : null,
    favoritePaths,
    nowMs,
  };
}

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
