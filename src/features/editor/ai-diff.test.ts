import { describe, expect, it } from "vitest";
import { compactDiffRows, createLineDiff, diffStats } from "./ai-diff";

describe("AI line diff", () => {
  it("tracks replacement line numbers and statistics", () => {
    const rows = createLineDiff("one\ntwo\nthree", "one\nsecond\nthree\nfour");
    expect(rows.map((row) => [row.kind, row.beforeLine, row.afterLine, row.text])).toEqual([
      ["equal", 1, 1, "one"],
      ["remove", 2, null, "two"],
      ["add", null, 2, "second"],
      ["equal", 3, 3, "three"],
      ["add", null, 4, "four"],
    ]);
    expect(diffStats(rows)).toEqual({ added: 2, removed: 1 });
  });

  it("collapses long unchanged sections around edits", () => {
    const before = Array.from({ length: 14 }, (_, index) => `line ${index}`).join("\n");
    const after = before.replace("line 7", "changed");
    const compact = compactDiffRows(createLineDiff(before, after), 2);
    expect(compact.filter((row) => row.kind === "skip")).toHaveLength(2);
    expect(compact.some((row) => row.kind === "remove" && row.text === "line 7")).toBe(true);
    expect(compact.some((row) => row.kind === "add" && row.text === "changed")).toBe(true);
  });
});
