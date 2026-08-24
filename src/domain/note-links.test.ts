import { describe, expect, it } from "vitest";
import corpus from "../features/library/fixtures/note-links-corpus.json";
import {
  buildNoteGraph,
  extractNoteLinks,
  isNoteMarkdownHref,
  noteRefsFromGraph,
  overlayLiveNoteGraph,
  resolveNoteRef,
} from "./note-links";

describe("extractNoteLinks", () => {
  it("matches the shared corpus", () => {
    for (const item of corpus.extract) {
      expect(extractNoteLinks(item.content), item.name).toEqual(item.links);
    }
  });

  it("skips inline-code wiki tokens next to CJK without expanding code points", () => {
    expect(extractNoteLinks("保留 [[Keep]] 和 `[[Nope]]` 以及中文。")).toEqual([
      { targetRef: "Keep", heading: "", displayText: "Keep", kind: "wiki" },
    ]);
  });
});

describe("resolveNoteRef", () => {
  it("matches the shared corpus", () => {
    for (const item of corpus.resolve) {
      expect(resolveNoteRef(item.targetRef, item.sourcePath, item.notes), item.name).toBe(
        item.resolved ?? undefined,
      );
    }
  });
});

describe("note graph helpers", () => {
  it("builds edges, backlinks, and live unresolved outgoing", () => {
    const graph = buildNoteGraph([
      {
        relativePath: "welcome.md",
        title: "Welcome",
        content: "See [[Alpha]] and [[Missing]].\n",
      },
      {
        relativePath: "work/alpha.md",
        title: "Alpha",
        content: "Back to [home](../welcome.md).\n",
      },
    ]);
    expect(graph.nodes.map((node) => node.relativePath)).toEqual(["welcome.md", "work/alpha.md"]);
    expect(graph.edges).toEqual([
      expect.objectContaining({
        sourcePath: "welcome.md",
        targetPath: "work/alpha.md",
        targetRef: "Alpha",
        kind: "wiki",
      }),
      expect.objectContaining({
        sourcePath: "welcome.md",
        targetPath: null,
        targetRef: "Missing",
        kind: "wiki",
      }),
      expect.objectContaining({
        sourcePath: "work/alpha.md",
        targetPath: "welcome.md",
        kind: "markdown",
      }),
    ]);

    const refs = noteRefsFromGraph(graph, "work/alpha.md");
    expect(refs.incoming).toHaveLength(1);
    expect(refs.incoming[0]?.sourcePath).toBe("welcome.md");
    expect(refs.outgoing[0]?.targetPath).toBe("welcome.md");

    const live = noteRefsFromGraph(graph, "welcome.md", extractNoteLinks("Only [[Missing]]."));
    expect(live.outgoing).toHaveLength(1);
    expect(live.unresolved.map((item) => item.targetRef)).toEqual(["Missing"]);

    const overlaid = overlayLiveNoteGraph(graph, "welcome.md", "Only [[Missing]].");
    expect(overlaid.nodes).toBe(graph.nodes);
    expect(overlaid.edges.filter((edge) => edge.sourcePath === "welcome.md")).toEqual([
      expect.objectContaining({ targetRef: "Missing", targetPath: null }),
    ]);
  });

  it("treats markdown note hrefs as in-app links", () => {
    expect(isNoteMarkdownHref("./work/alpha.md#x")).toBe(true);
    expect(isNoteMarkdownHref("https://example.com/a.md")).toBe(false);
    expect(isNoteMarkdownHref("attachments/2024-01/a.png")).toBe(false);
  });
});
