import type { HeadingItem } from "../../domain/notes";

export type OutlineNode = {
  heading: HeadingItem;
  level: number;
  children: OutlineNode[];
};

const collapsedByDocument = new Map<string, Set<string>>();

export function minHeadingDepth(headings: HeadingItem[]) {
  return headings.reduce((min, heading) => Math.min(min, heading.depth), 6);
}

export function outlineLevel(depth: number, minDepth: number) {
  return Math.max(1, depth - minDepth + 1);
}

export function headingInset(level: number) {
  const maxIndentLevel = 4;
  const baseInset = 14;
  const insetStep = 18;
  return baseInset + Math.min(Math.max(level, 1) - 1, maxIndentLevel) * insetStep;
}

export function buildOutlineTree(headings: HeadingItem[]): OutlineNode[] {
  const rootDepth = minHeadingDepth(headings);
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  for (const heading of headings) {
    const node: OutlineNode = {
      heading,
      level: outlineLevel(heading.depth, rootDepth),
      children: [],
    };
    while (stack.length && stack[stack.length - 1]!.level >= node.level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }

  return roots;
}

export function flattenVisibleOutline(
  nodes: OutlineNode[],
  collapsedIds: ReadonlySet<string>,
): OutlineNode[] {
  const visible: OutlineNode[] = [];
  const walk = (list: OutlineNode[]) => {
    for (const node of list) {
      visible.push(node);
      if (node.children.length && !collapsedIds.has(node.heading.id)) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return visible;
}

function nodeContainsId(node: OutlineNode, id: string): boolean {
  return node.children.some(
    (child) => child.heading.id === id || nodeContainsId(child, id),
  );
}

export function visibleOutlineHighlightId(
  nodes: OutlineNode[],
  collapsedIds: ReadonlySet<string>,
  activeId: string | null,
): string | null {
  if (!activeId) return null;

  const walk = (list: OutlineNode[]): string | null => {
    for (const node of list) {
      if (node.heading.id === activeId) return node.heading.id;
      if (!node.children.length) continue;
      if (collapsedIds.has(node.heading.id)) {
        if (nodeContainsId(node, activeId)) return node.heading.id;
        continue;
      }
      const nested = walk(node.children);
      if (nested) return nested;
    }
    return null;
  };

  return walk(nodes);
}

export function readCollapsedHeadingIds(documentKey: string | null): Set<string> {
  if (!documentKey) return new Set();
  const stored = collapsedByDocument.get(documentKey);
  return stored ? new Set(stored) : new Set();
}

export function writeCollapsedHeadingIds(
  documentKey: string | null,
  ids: Iterable<string>,
) {
  if (!documentKey) return;
  collapsedByDocument.set(documentKey, new Set(ids));
}

export function pruneCollapsedHeadingIds(
  documentKey: string | null,
  headings: HeadingItem[],
): Set<string> {
  const valid = new Set(headings.map((heading) => heading.id));
  const next = new Set(
    [...readCollapsedHeadingIds(documentKey)].filter((id) => valid.has(id)),
  );
  writeCollapsedHeadingIds(documentKey, next);
  return next;
}

export function resetCollapsedHeadingIds() {
  collapsedByDocument.clear();
}
