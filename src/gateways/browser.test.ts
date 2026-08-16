import { describe, expect, it, vi } from "vitest";
import { BrowserWorkspaceGateway } from "./browser";

describe("BrowserWorkspaceGateway", () => {
  it("returns title tags and excerpt from the in-memory scan", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const notes = await gateway.scanWorkspace("demo://memoir");
    const welcome = notes.find((note) => note.relativePath === "welcome.mdx");
    expect(welcome?.title).toBe("Welcome to Memoir");
    expect(welcome?.tags).toEqual(["memoir", "mdx"]);
    expect(welcome?.excerpt.length).toBeGreaterThan(0);
  });

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

  it("downloads a PDF export in the browser demo", async () => {
    const createObjectURL = vi.fn(() => "blob:export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const gateway = new BrowserWorkspaceGateway();
    const path = await gateway.chooseExportPath({ defaultPath: "demo://memoir/two.pdf" });
    expect(path).toBe("two.pdf");
    await gateway.writeExportFile(path, "AAAA");
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
    vi.unstubAllGlobals();
  });

  it("reports an in-memory index for the demo workspace", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const info = await gateway.getIndexInfo("demo://memoir");
    expect(info.persistent).toBe(false);
    expect(info.relativePath).toBe(".memoir/index.sqlite");
    expect(info.noteCount).toBeGreaterThan(0);
    expect(info.tagCount).toBeGreaterThan(0);
    await expect(gateway.rebuildIndex("demo://memoir")).resolves.toMatchObject({
      persistent: false,
      noteCount: info.noteCount,
    });
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
