export const FOLDER_COLORS = [
  "coral",
  "blue",
  "green",
  "gold",
  "violet",
  "slate",
  "ink",
] as const;

export type FolderColor = (typeof FOLDER_COLORS)[number];

export type FolderAppearance = {
  emoji?: string;
  color?: FolderColor;
};

export const FOLDER_COLOR_HEX: Record<FolderColor, string> = {
  coral: "#d65f4d",
  blue: "#3f7edb",
  green: "#3e9b73",
  gold: "#b98b09",
  violet: "#8a65d1",
  slate: "#607287",
  ink: "#343532",
};

export const FOLDER_EMOJIS = [
  "📓",
  "📔",
  "📒",
  "📕",
  "📗",
  "📘",
  "📙",
  "📚",
  "📝",
  "✏️",
  "💡",
  "🧠",
  "💭",
  "✨",
  "⭐",
  "❤️",
  "🏠",
  "🗂️",
  "📁",
  "📅",
  "🗓️",
  "⏰",
  "📌",
  "📎",
  "💻",
  "🖥️",
  "📱",
  "⚙️",
  "🔧",
  "🧪",
  "🔬",
  "📊",
  "🌱",
  "🌿",
  "🌸",
  "🍀",
  "🌙",
  "☀️",
  "🌊",
  "🔥",
  "☕",
  "🍵",
  "🍎",
  "🎵",
  "🎨",
  "📷",
  "✈️",
  "🗺️",
  "🎯",
  "🏆",
  "💪",
  "🧘",
  "🎮",
  "🧩",
  "🔑",
  "🔒",
] as const;

const MAX_EMOJI_LENGTH = 16;

export function isFolderColor(value: unknown): value is FolderColor {
  return typeof value === "string" && (FOLDER_COLORS as readonly string[]).includes(value);
}

export function extractEmoji(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const IntlWithSegmenter = Intl as unknown as {
    Segmenter?: new (
      locales?: string | string[],
      options?: { granularity?: "grapheme" | "word" | "sentence" },
    ) => { segment: (input: string) => Iterable<{ segment: string }> };
  };
  if (IntlWithSegmenter.Segmenter) {
    const segmenter = new IntlWithSegmenter.Segmenter(undefined, { granularity: "grapheme" });
    for (const { segment } of segmenter.segment(trimmed)) {
      if (isEmojiGrapheme(segment)) return segment;
    }
    return undefined;
  }

  const match = trimmed.match(
    /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/u,
  );
  return match && isEmojiGrapheme(match[0]) ? match[0] : undefined;
}

export function normalizeFolderKey(folder: string): string {
  return folder.trim().replace(/^[/\\]+|[/\\]+$/g, "");
}

export function expandFolderAncestors(folder: string): string[] {
  const key = normalizeFolderKey(folder);
  if (!key) return [];
  const parts = key.split(/[/\\]+/).filter(Boolean);
  const result: string[] = [];
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    result.push(current);
  }
  return result;
}

export function collectFolderPaths(
  folders: Iterable<string>,
  locales?: string | string[],
): string[] {
  const unique = new Set<string>();
  for (const folder of folders) {
    for (const ancestor of expandFolderAncestors(folder)) unique.add(ancestor);
  }
  return [...unique].sort((left, right) => left.localeCompare(right, locales));
}

export function parentFolder(folder: string): string {
  const key = normalizeFolderKey(folder);
  const index = key.lastIndexOf("/");
  return index === -1 ? "" : key.slice(0, index);
}

export function folderSegment(folder: string): string {
  const key = normalizeFolderKey(folder);
  const index = key.lastIndexOf("/");
  return index === -1 ? key : key.slice(index + 1);
}

export type FolderTreeNode = {
  folder: string;
  name: string;
  count: number;
  directCount: number;
  children: FolderTreeNode[];
};

export function buildFolderTree(
  stats: Array<{ folder: string; count: number }>,
  locales?: string | string[],
): FolderTreeNode[] {
  const direct = new Map<string, number>();
  for (const item of stats) {
    const folder = normalizeFolderKey(item.folder);
    direct.set(folder, (direct.get(folder) ?? 0) + item.count);
  }

  const paths = new Set<string>();
  for (const folder of direct.keys()) {
    if (folder) paths.add(folder);
    for (const ancestor of expandFolderAncestors(folder)) paths.add(ancestor);
  }

  const nodes = new Map<string, FolderTreeNode>();
  const ensure = (folder: string) => {
    let node = nodes.get(folder);
    if (!node) {
      node = {
        folder,
        name: folderSegment(folder),
        count: 0,
        directCount: direct.get(folder) ?? 0,
        children: [],
      };
      nodes.set(folder, node);
    }
    return node;
  };

  for (const folder of paths) ensure(folder);

  const top: FolderTreeNode[] = [];
  for (const folder of paths) {
    const node = ensure(folder);
    const parentKey = parentFolder(folder);
    if (!parentKey) {
      top.push(node);
      continue;
    }
    ensure(parentKey).children.push(node);
  }

  const rollup = (node: FolderTreeNode): number => {
    node.children.sort((left, right) =>
      left.name.localeCompare(right.name, locales, { numeric: true }),
    );
    let total = node.directCount;
    for (const child of node.children) total += rollup(child);
    node.count = total;
    return total;
  };

  for (const node of top) rollup(node);
  top.sort((left, right) => left.name.localeCompare(right.name, locales, { numeric: true }));

  const rootCount = direct.get("") ?? 0;
  if (rootCount > 0) {
    top.unshift({
      folder: "",
      name: "",
      count: rootCount,
      directCount: rootCount,
      children: [],
    });
  }
  return top;
}

export function normalizeFolderAppearance(value: unknown): FolderAppearance | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as { emoji?: unknown; color?: unknown };
  const emoji = typeof raw.emoji === "string" ? extractEmoji(raw.emoji) : undefined;
  const color = isFolderColor(raw.color) ? raw.color : undefined;
  if (!emoji && !color) return undefined;
  return {
    ...(emoji ? { emoji } : {}),
    ...(color ? { color } : {}),
  };
}

export function folderAppearancesForWorkspace(
  appearances: Record<string, Record<string, FolderAppearance>> | undefined,
  workspaceRoot: string,
): Record<string, FolderAppearance> {
  const raw = appearances?.[workspaceRoot] ?? {};
  const next: Record<string, FolderAppearance> = {};
  for (const [folder, appearance] of Object.entries(raw)) {
    const normalized = normalizeFolderAppearance(appearance);
    if (normalized) next[folder] = normalized;
  }
  return next;
}

function isEmojiGrapheme(value: string) {
  return (
    value.length > 0 &&
    value.length <= MAX_EMOJI_LENGTH &&
    /\p{Extended_Pictographic}/u.test(value) &&
    ![...value].some((character) => character.charCodeAt(0) < 32)
  );
}
