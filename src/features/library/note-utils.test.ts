import { describe, expect, it } from "vitest";
import {
  addUniqueTags,
  extractHeadings,
  extractTitle,
  filterNotes,
  folderName,
  isRootFolder,
  noteStats,
  parseNote,
  parseTagTokens,
} from "./note-utils";
import type { NoteMeta } from "../../domain/notes";

const notes: NoteMeta[] = [
  {
    relativePath: "work/alpha.md",
    fileName: "alpha.md",
    extension: "md",
    modifiedMs: 100,
    size: 10,
    title: "Alpha",
    tags: ["work"],
    excerpt: "First project",
    favorite: true,
  },
  {
    relativePath: "beta.mdx",
    fileName: "beta.mdx",
    extension: "mdx",
    modifiedMs: 1,
    size: 20,
    title: "Beta",
    tags: [],
    excerpt: "Second note",
    favorite: false,
  },
];

describe("note utilities", () => {
  it("parses frontmatter title tags and excerpt", () => {
    const parsed = parseNote(
      "---\ntitle: Project Plan\ntags: [roadmap, team]\n---\n\n# Ignored\n\nUseful summary.",
      "fallback.md",
    );
    expect(parsed.title).toBe("Project Plan");
    expect(parsed.tags).toEqual(["roadmap", "team"]);
    expect(parsed.excerpt).toContain("Useful summary");
  });

  it("resolves title from frontmatter, then first h1, then filename", () => {
    expect(
      parseNote("---\ntitle: 今天吃什么\ntags: []\n---\n\n# Two Sum\n\nbody", "memoir.mdx").title,
    ).toBe("今天吃什么");
    expect(parseNote("---\ntitle: \"  \"\n---\n\n# Real heading\n", "note.md").title).toBe(
      "Real heading",
    );
    expect(parseNote("# First heading\n\n## Second\n", "journal.md").title).toBe("First heading");
    expect(parseNote("## Not a title\n\nplain text", "notes.md").title).toBe("notes");
    expect(extractTitle("no headings here", "diary.mdx")).toBe("diary");
  });

  it("ignores headings inside fenced examples and prefers a real h1", () => {
    const readmeLike = `<p align="center">
  <img src="docs/assets/logo.svg" width="96" alt="Memoir" />
</p>

<h1 align="center">Memoir</h1>

## Features

\`\`\`\`md
---
title: Two Sum
---

# Two Sum
\`\`\`\`
`;
    expect(parseNote(readmeLike, "memoir.mdx").title).toBe("Memoir");
    expect(parseNote("````md\n# Two Sum\n````\n\n## Features\n", "README.md").title).toBe("README");
    expect(parseNote("# **Bold Title**\n", "a.md").title).toBe("Bold Title");
  });

  it("extracts stable heading ids and word statistics", () => {
    expect(extractHeadings("# Hello\n## Hello\n### 世界")).toEqual([
      { id: "hello", depth: 1, text: "Hello" },
      { id: "hello-1", depth: 2, text: "Hello" },
      { id: "世界", depth: 3, text: "世界" },
    ]);
    expect(extractHeadings("# Real\n```\n# Fake\n```\n## Also real")).toEqual([
      { id: "real", depth: 1, text: "Real" },
      { id: "also-real", depth: 2, text: "Also real" },
    ]);
    expect(noteStats("Hello world 世界")).toEqual({
      words: 4,
      chars: 14,
      minutes: 1,
    });
  });

  it("filters by query navigation folder and tag", () => {
    expect(filterNotes(notes, "project", "all", null, 100)).toEqual([notes[0]]);
    expect(filterNotes(notes, "", "favorites", null, 100)).toEqual([notes[0]]);
    expect(filterNotes(notes, "", "uncategorized", null, 100)).toEqual([notes[1]]);
    expect(
      filterNotes(notes, "", "all", { type: "folder", value: "work" }, 100),
    ).toEqual([notes[0]]);
    expect(filterNotes(notes, "", "all", { type: "folder", value: "" }, 100)).toEqual([
      notes[1],
    ]);
    expect(filterNotes(notes, "", "all", { type: "tag", value: "WORK" }, 100)).toEqual([
      notes[0],
    ]);
  });

  it("parses and deduplicates tag tokens", () => {
    expect(parseTagTokens("leetcode, rust，算法")).toEqual(["leetcode", "rust", "算法"]);
    expect(parseTagTokens("  work , , diary  ")).toEqual(["work", "diary"]);
    expect(addUniqueTags(["Work"], ["work", "diary", "  "])).toEqual(["Work", "diary"]);
  });

  it("uses a stable sentinel for workspace-root notes", () => {
    expect(folderName("beta.mdx")).toBe("");
    expect(folderName("work/alpha.md")).toBe("work");
    expect(isRootFolder(folderName("beta.mdx"))).toBe(true);
    expect(isRootFolder(folderName("work/alpha.md"))).toBe(false);
  });
});
