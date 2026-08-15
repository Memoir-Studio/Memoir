import { describe, expect, it } from "vitest";
import { rehypeSourceLines } from "./source-line";

describe("rehypeSourceLines", () => {
  it("tags block elements with their markdown start line", () => {
    const heading = {
      type: "element",
      tagName: "h1",
      properties: {} as Record<string, unknown>,
      position: { start: { line: 3 } },
      children: [],
    };
    const emphasis = {
      type: "element",
      tagName: "em",
      properties: {} as Record<string, unknown>,
      position: { start: { line: 4 } },
      children: [],
    };
    const tree = { type: "root", children: [heading, emphasis] };

    rehypeSourceLines()(tree);

    expect(heading.properties["data-source-line"]).toBe(3);
    expect(emphasis.properties["data-source-line"]).toBeUndefined();
  });
});
