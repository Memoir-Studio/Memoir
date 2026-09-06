export type MarkdownLineFormat =
  | { kind: "heading"; level: 0 | 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: "quote" }
  | { kind: "bullet-list" }
  | { kind: "ordered-list" }
  | { kind: "task-list" };

export type MarkdownLineEdit = {
  from: number;
  to: number;
  insert: string;
  selectionFrom: number;
  selectionTo: number;
};

function lineStart(source: string, position: number) {
  return position <= 0 ? 0 : source.lastIndexOf("\n", position - 1) + 1;
}

function lineEnd(source: string, position: number) {
  const end = source.indexOf("\n", position);
  return end < 0 ? source.length : end;
}

function contentParts(line: string) {
  const indent = line.match(/^\s*/)?.[0] ?? "";
  return { indent, content: line.slice(indent.length) };
}

function stripListMarker(content: string) {
  return content
    .replace(/^(?:[-+*])\s+\[[ xX]\]\s+/, "")
    .replace(/^(?:[-+*]|\d+[.)])\s+/, "");
}

function hasFormat(line: string, format: MarkdownLineFormat) {
  const { content } = contentParts(line);
  if (!content) return true;
  switch (format.kind) {
    case "heading":
      return format.level > 0 && new RegExp(`^#{${format.level}}\\s+`).test(content);
    case "quote":
      return /^>\s?/.test(content);
    case "bullet-list":
      return /^(?:[-+*])\s+(?!\[[ xX]\]\s+)/.test(content);
    case "ordered-list":
      return /^\d+[.)]\s+/.test(content);
    case "task-list":
      return /^(?:[-+*])\s+\[[ xX]\]\s+/.test(content);
  }
}

/** Applies block-level Markdown formatting to every line touched by a selection. */
export function formatMarkdownLines(
  source: string,
  selectionFrom: number,
  selectionTo: number,
  format: MarkdownLineFormat,
  placeholder = "",
): MarkdownLineEdit {
  const from = Math.max(0, Math.min(selectionFrom, source.length));
  const to = Math.max(from, Math.min(selectionTo, source.length));
  const start = lineStart(source, from);
  const lastSelectedPosition = to > from && source[to - 1] === "\n" ? to - 1 : to;
  const end = lineEnd(source, lastSelectedPosition);
  const original = source.slice(start, end);
  const lines = original.split("\n");
  const meaningfulLines = lines.filter((line) => contentParts(line).content.length > 0);
  const removeFormat =
    format.kind === "heading" && format.level === 0
      ? true
      : meaningfulLines.length > 0 && meaningfulLines.every((line) => hasFormat(line, format));
  let orderedIndex = 1;

  const transformed = lines.map((line) => {
    const { indent, content: initialContent } = contentParts(line);
    const content = !initialContent && lines.length === 1 ? placeholder : initialContent;
    if (!content) return line;

    if (format.kind === "heading") {
      const clean = content.replace(/^#{1,6}\s+/, "");
      return `${indent}${removeFormat ? "" : `${"#".repeat(format.level)} `}${clean}`;
    }
    if (format.kind === "quote") {
      const clean = content.replace(/^>\s?/, "");
      return `${indent}${removeFormat ? "" : "> "}${clean}`;
    }

    const clean = stripListMarker(content);
    if (removeFormat) return `${indent}${clean}`;
    if (format.kind === "bullet-list") return `${indent}- ${clean}`;
    if (format.kind === "task-list") return `${indent}- [ ] ${clean}`;
    return `${indent}${orderedIndex++}. ${clean}`;
  });

  const insert = transformed.join("\n");
  const cursorOnly = selectionFrom === selectionTo;
  return {
    from: start,
    to: end,
    insert,
    selectionFrom: cursorOnly ? start + insert.length : start,
    selectionTo: start + insert.length,
  };
}
