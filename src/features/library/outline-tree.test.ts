import { afterEach, describe, expect, it } from "vitest";
import type { HeadingItem } from "../../domain/notes";
import {
  buildOutlineTree,
  flattenVisibleOutline,
  pruneCollapsedHeadingIds,
  readCollapsedHeadingIds,
  resetCollapsedHeadingIds,
  visibleOutlineHighlightId,
  writeCollapsedHeadingIds,
} from "./outline-tree";

const headings: HeadingItem[] = [
  { id: "welcome", depth: 1, text: "欢迎使用 Inkstone" },
  { id: "try-now", depth: 2, text: "现在就试试" },
  { id: "markdown", depth: 2, text: "Markdown 速查" },
  { id: "links", depth: 3, text: "链接、图片与笔记关系" },
  { id: "formula", depth: 3, text: "公式与图表" },
];

afterEach(() => {
  resetCollapsedHeadingIds();
});

describe("buildOutlineTree", () => {
  it("nests headings under the nearest shallower ancestor", () => {
    const tree = buildOutlineTree(headings);

    expect(tree.map((node) => node.heading.id)).toEqual(["welcome"]);
    expect(tree[0]?.level).toBe(1);
    expect(tree[0]?.children.map((node) => node.heading.id)).toEqual([
      "try-now",
      "markdown",
    ]);
    expect(tree[0]?.children[1]?.children.map((node) => node.heading.id)).toEqual([
      "links",
      "formula",
    ]);
  });

  it("pins the shallowest heading to level 1 when the note starts at h3", () => {
    const tree = buildOutlineTree([
      { id: "p0", depth: 3, text: "最高优先级" },
      { id: "p1", depth: 3, text: "很高优先级" },
      { id: "p2", depth: 4, text: "细节" },
    ]);

    expect(tree.map((node) => [node.heading.id, node.level])).toEqual([
      ["p0", 1],
      ["p1", 1],
    ]);
    expect(tree[1]?.children.map((node) => [node.heading.id, node.level])).toEqual([
      ["p2", 2],
    ]);
  });

  it("keeps a skipped-depth heading under the open ancestor", () => {
    const tree = buildOutlineTree([
      { id: "a", depth: 1, text: "A" },
      { id: "b", depth: 3, text: "B" },
      { id: "c", depth: 2, text: "C" },
    ]);

    expect(tree[0]?.children.map((node) => node.heading.id)).toEqual(["b", "c"]);
    expect(tree[0]?.children.map((node) => node.level)).toEqual([3, 2]);
  });
});

describe("flattenVisibleOutline", () => {
  it("hides every descendant of a collapsed node", () => {
    const tree = buildOutlineTree(headings);
    const visible = flattenVisibleOutline(tree, new Set(["markdown"]));

    expect(visible.map((node) => node.heading.id)).toEqual([
      "welcome",
      "try-now",
      "markdown",
    ]);
  });

  it("hides nested descendants when a higher ancestor is collapsed", () => {
    const tree = buildOutlineTree(headings);
    const visible = flattenVisibleOutline(tree, new Set(["welcome"]));

    expect(visible.map((node) => node.heading.id)).toEqual(["welcome"]);
  });
});

describe("visibleOutlineHighlightId", () => {
  it("keeps the active heading when it is still visible", () => {
    const tree = buildOutlineTree(headings);
    expect(visibleOutlineHighlightId(tree, new Set(), "links")).toBe("links");
  });

  it("moves the highlight to the nearest visible ancestor", () => {
    const tree = buildOutlineTree(headings);
    expect(visibleOutlineHighlightId(tree, new Set(["markdown"]), "links")).toBe(
      "markdown",
    );
    expect(visibleOutlineHighlightId(tree, new Set(["welcome"]), "formula")).toBe(
      "welcome",
    );
  });
});

describe("collapsed heading persistence", () => {
  it("remembers collapsed ids per document and drops stale ones", () => {
    writeCollapsedHeadingIds("welcome.md", ["markdown", "gone"]);
    expect([...readCollapsedHeadingIds("welcome.md")].sort()).toEqual([
      "gone",
      "markdown",
    ]);
    expect([...readCollapsedHeadingIds("other.md")]).toEqual([]);

    const pruned = pruneCollapsedHeadingIds("welcome.md", headings);
    expect([...pruned]).toEqual(["markdown"]);
    expect([...readCollapsedHeadingIds("welcome.md")]).toEqual(["markdown"]);
  });
});
