import { describe, expect, it } from "vitest";
import { defaultExportPath, suggestedPdfFileName } from "./pdf-file-name";

describe("suggestedPdfFileName", () => {
  it("uses the title and strips illegal characters", () => {
    expect(suggestedPdfFileName("two", "two.mdx")).toBe("two.pdf");
    expect(suggestedPdfFileName("Hello / World?", "note.md")).toBe("Hello World.pdf");
  });

  it("falls back to the file stem when the title is empty", () => {
    expect(suggestedPdfFileName("   ", "日记/today.md")).toBe("today.pdf");
  });
});

describe("defaultExportPath", () => {
  it("places the PDF next to the note", () => {
    expect(defaultExportPath("/notes", "日记/today.md", "today.pdf")).toBe("/notes/日记/today.pdf");
    expect(defaultExportPath("/notes", "two.mdx", "two.pdf")).toBe("/notes/two.pdf");
    expect(defaultExportPath(null, "two.mdx", "two.pdf")).toBe("two.pdf");
  });
});
