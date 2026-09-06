import { describe, expect, it } from "vitest";
import { formatMarkdownLines } from "./markdown-format";

function apply(source: string, from: number, to: number, format: Parameters<typeof formatMarkdownLines>[3]) {
  const edit = formatMarkdownLines(source, from, to, format, "item");
  return source.slice(0, edit.from) + edit.insert + source.slice(edit.to);
}

describe("formatMarkdownLines", () => {
  it("changes an existing heading level and toggles it off", () => {
    expect(apply("# Title", 3, 3, { kind: "heading", level: 2 })).toBe("## Title");
    expect(apply("## Title", 0, 8, { kind: "heading", level: 2 })).toBe("Title");
  });

  it("formats every selected line as a renumbered ordered list", () => {
    expect(apply("alpha\n- beta\ncharlie", 0, 14, { kind: "ordered-list" })).toBe(
      "1. alpha\n2. beta\n3. charlie",
    );
  });

  it("converts list markers to task items and preserves indentation", () => {
    expect(apply("  - first\n  2. second", 0, 21, { kind: "task-list" })).toBe(
      "  - [ ] first\n  - [ ] second",
    );
  });

  it("toggles a quote across multiple lines without prefixing blank lines", () => {
    const quoted = apply("first\n\nsecond", 0, 13, { kind: "quote" });
    expect(quoted).toBe("> first\n\n> second");
    expect(apply(quoted, 0, quoted.length, { kind: "quote" })).toBe("first\n\nsecond");
  });

  it("uses a placeholder when formatting an empty line", () => {
    expect(apply("", 0, 0, { kind: "bullet-list" })).toBe("- item");
  });

  it("formats the empty first line when the document starts with a newline", () => {
    expect(apply("\nsecond", 0, 0, { kind: "bullet-list" })).toBe("- item\nsecond");
  });
});
