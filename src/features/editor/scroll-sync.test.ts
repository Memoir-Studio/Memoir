import { describe, expect, it } from "vitest";
import {
  bodySourceLineOffset,
  collectPreviewAnchors,
  countDocumentLines,
  lineForScrollTop,
  scrollTopForLine,
  syncViewportOffset,
} from "./scroll-sync";

const scroller = { scrollHeight: 2000, clientHeight: 400 };

function rect(top: number, height = 20): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 100,
    bottom: top + height,
    width: 100,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("countDocumentLines", () => {
  it("counts a trailing newline as its own line", () => {
    expect(countDocumentLines("")).toBe(1);
    expect(countDocumentLines("one")).toBe(1);
    expect(countDocumentLines("one\ntwo")).toBe(2);
    expect(countDocumentLines("one\ntwo\n")).toBe(3);
  });
});

describe("bodySourceLineOffset", () => {
  it("counts frontmatter lines that precede the rendered body", () => {
    const content = "---\ntitle: Tasks\n---\n\n# Hello\n";
    expect(bodySourceLineOffset(content, "# Hello\n")).toBe(4);
    expect(bodySourceLineOffset("# Hello\n", "# Hello\n")).toBe(0);
    expect(bodySourceLineOffset("nope", "# Hello\n")).toBe(0);
  });
});

describe("scroll line mapping", () => {
  const anchors = [
    { line: 5, top: 200 },
    { line: 25, top: 1200 },
  ];

  it("interpolates between neighboring preview anchors", () => {
    expect(scrollTopForLine(15, anchors, scroller, 40)).toBeCloseTo(700);
  });

  it("round-trips a mapped line through scrollTop", () => {
    const line = 15.25;
    const top = scrollTopForLine(line, anchors, scroller, 40, 32);
    expect(lineForScrollTop(top, anchors, scroller, 40, 32)).toBeCloseTo(line);
  });

  it("pins the start and end of the document", () => {
    expect(scrollTopForLine(1, anchors, scroller, 40)).toBe(0);
    expect(scrollTopForLine(41, anchors, scroller, 40)).toBe(1600);
    expect(lineForScrollTop(0, anchors, scroller, 40)).toBe(1);
  });

  it("maps through document sentinels when preview has no tagged blocks", () => {
    const top = (20 / 41) * scroller.scrollHeight;
    expect(scrollTopForLine(21, [], scroller, 41)).toBeCloseTo(top);
    expect(lineForScrollTop(top, [], scroller, 41)).toBeCloseTo(21);
  });

  it("keeps a short viewport unmoved", () => {
    const short = { scrollHeight: 200, clientHeight: 400 };
    expect(scrollTopForLine(12, anchors, short, 40)).toBe(0);
    expect(lineForScrollTop(0, anchors, short, 1)).toBe(1);
  });
});

describe("collectPreviewAnchors", () => {
  it("lifts body-relative source lines and keeps the topmost block per line", () => {
    const root = document.createElement("div");
    const first = document.createElement("h2");
    const nested = document.createElement("p");
    const later = document.createElement("p");
    first.dataset.sourceLine = "1";
    nested.dataset.sourceLine = "1";
    later.dataset.sourceLine = "8";
    root.append(first, nested, later);

    root.getBoundingClientRect = () => rect(0, 400);
    first.getBoundingClientRect = () => rect(40);
    nested.getBoundingClientRect = () => rect(80);
    later.getBoundingClientRect = () => rect(300);
    Object.defineProperty(root, "scrollTop", { value: 10 });

    expect(collectPreviewAnchors(root, 4)).toEqual([
      { line: 5, top: 50 },
      { line: 12, top: 310 },
    ]);
  });
});

describe("syncViewportOffset", () => {
  it("stays within a small band near the top of the pane", () => {
    expect(syncViewportOffset(200)).toBeCloseTo(24);
    expect(syncViewportOffset(800)).toBe(48);
    expect(syncViewportOffset(0)).toBe(0);
  });
});
