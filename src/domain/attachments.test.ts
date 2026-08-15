import { describe, expect, it } from "vitest";
import {
  attachmentMonthDir,
  attachmentRelativePath,
  collectClipboardImages,
  escapeMarkdownAlt,
  formatBytes,
  isImageFile,
  markdownForAttachments,
  markdownImageForAttachment,
  padMarkdownBlock,
  sanitizeAttachmentFileName,
  suggestedPasteFileName,
} from "./attachments";

describe("attachments", () => {
  it("sanitizes names and keeps CJK stems", () => {
    expect(sanitizeAttachmentFileName("截图 1.png")).toBe("截图-1.png");
    expect(sanitizeAttachmentFileName("../escape/photo.jpeg")).toBe("photo.jpeg");
    expect(sanitizeAttachmentFileName("...")).toBe("image");
  });

  it("names pasted clipboard images with a timestamp", () => {
    const now = new Date("2026-08-15T14:30:52");
    expect(suggestedPasteFileName({ name: "image.png", type: "image/png" }, now)).toBe(
      "paste-20260815-143052.png",
    );
    expect(suggestedPasteFileName({ name: "diagram.webp", type: "" }, now)).toBe("diagram.webp");
  });

  it("builds markdown that stays relative to the current note", () => {
    const attachment = {
      relativePath: ".memoir-attachments/2026-08/paste-1.png",
      fileName: "paste-1.png",
    };
    expect(markdownImageForAttachment("welcome.md", attachment)).toBe(
      "![paste-1](.memoir-attachments/2026-08/paste-1.png)",
    );
    expect(markdownImageForAttachment("日记/today.md", attachment)).toBe(
      "![paste-1](../.memoir-attachments/2026-08/paste-1.png)",
    );
    expect(escapeMarkdownAlt("weird [alt]")).toBe("weird alt");
    expect(
      markdownForAttachments("welcome.md", [
        attachment,
        { relativePath: ".memoir-attachments/2026-08/b.gif", fileName: "b.gif" },
      ]),
    ).toBe(
      "![paste-1](.memoir-attachments/2026-08/paste-1.png)\n\n![b](.memoir-attachments/2026-08/b.gif)",
    );
  });

  it("nests new files under a year-month folder", () => {
    const now = new Date("2026-08-15T14:30:52");
    expect(attachmentMonthDir(now)).toBe("2026-08");
    expect(attachmentRelativePath("photo.png", now)).toBe(
      ".memoir-attachments/2026-08/photo.png",
    );
  });

  it("pads attachment markdown so it does not glue onto the current line", () => {
    expect(padMarkdownBlock("![a](a.png)", "```mermaid", "graph LR")).toBe("\n\n![a](a.png)\n\n");
    expect(padMarkdownBlock("![a](a.png)", "# Title\n\n", "\n\nnext")).toBe("![a](a.png)");
    expect(padMarkdownBlock("![a](a.png)", "line\n", "more")).toBe("\n![a](a.png)\n\n");
  });

  it("formats sizes and recognizes image files", () => {
    expect(formatBytes(800)).toBe("800 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(12_288)).toBe("12 KB");
    expect(formatBytes(2_097_152)).toBe("2.0 MB");
    expect(isImageFile({ name: "shot.PNG", type: "" })).toBe(true);
    expect(isImageFile({ name: "notes.md", type: "text/markdown" })).toBe(false);
  });

  it("collects image files from clipboard items", () => {
    const png = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    const data = {
      items: [
        {
          kind: "file",
          type: "image/png",
          getAsFile: () => png,
        },
      ],
      files: [png],
    } as unknown as DataTransfer;
    expect(collectClipboardImages(data)).toEqual([png]);
    expect(collectClipboardImages(null)).toEqual([]);
  });
});
