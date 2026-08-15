import { describe, expect, it } from "vitest";
import { BrowserWorkspaceGateway } from "./browser";

describe("BrowserWorkspaceGateway", () => {
  it("writes multiple tags into the new note frontmatter", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const path = await gateway.createNote({
      root: "demo://memoir",
      title: "New Practice",
      extension: "md",
      folder: "LeetCode",
      tags: ["leetcode", "rust"],
    });

    expect(path).toBe("LeetCode/new-practice.md");
    expect(await gateway.readNote("demo://memoir", path)).toContain(
      'tags: ["leetcode", "rust"]',
    );
  });

  it("stores pasted attachments in memory and resolves them as data URLs", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const saved = await gateway.saveAttachment("demo://memoir", {
      bytesBase64: "AAAA",
      fileName: "paste.png",
      mimeType: "image/png",
    });
    expect(saved.relativePath).toMatch(/^\.memoir-attachments\/\d{4}-\d{2}\/paste\.png$/);
    expect(await gateway.scanAttachments("demo://memoir")).toHaveLength(1);
    expect(gateway.resolveMediaPath(`demo://memoir/${saved.relativePath}`)).toMatch(
      /^data:image\/png;base64,AAAA$/,
    );
    await gateway.deleteAttachment("demo://memoir", saved.relativePath);
    expect(await gateway.scanAttachments("demo://memoir")).toEqual([]);
  });
});
