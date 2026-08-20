import { describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "../platform/app-version";
import { BrowserPersistenceGateway, BrowserWorkspaceGateway } from "./browser";

describe("BrowserPersistenceGateway", () => {
  it("does not call GitHub and reports the demo as up to date", async () => {
    const gateway = new BrowserPersistenceGateway();
    await expect(gateway.checkAppUpdate()).resolves.toEqual({
      status: "upToDate",
      currentVersion: APP_VERSION,
      latestVersion: APP_VERSION,
      releaseUrl: null,
      releaseNotes: null,
    });
    await expect(gateway.skipAppUpdate("0.1.7")).resolves.toBeUndefined();
  });
});

describe("BrowserWorkspaceGateway", () => {
  it("returns title tags and excerpt from the in-memory scan", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const page = await gateway.queryLibrary("demo://memoir", {
      q: "",
      nav: "all",
      folder: null,
      tag: null,
    });
    const notes = page.notes;
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

    expect(path.relativePath).toBe("LeetCode/new-practice.md");
    expect(await gateway.readNote("demo://memoir", path.relativePath)).toContain(
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

  it("filters the in-memory library with the same query contract", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const all = await gateway.queryLibrary("demo://memoir", {
      q: "",
      nav: "all",
      folder: null,
      tag: null,
    });
    const tagged = await gateway.queryLibrary("demo://memoir", {
      q: "",
      nav: "all",
      folder: null,
      tag: "diary",
    });
    const folder = await gateway.queryLibrary("demo://memoir", {
      q: "",
      nav: "all",
      folder: "日记",
      tag: null,
    });
    expect(all.stats.total).toBeGreaterThan(0);
    expect(tagged.notes.every((note) => note.tags.map((tag) => tag.toLowerCase()).includes("diary"))).toBe(
      true,
    );
    expect(folder.notes.every((note) => note.relativePath.startsWith("日记/"))).toBe(true);
  });

  it("reports an in-memory index for the demo workspace", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const info = await gateway.getIndexInfo("demo://memoir");
    expect(info.persistent).toBe(false);
    expect(info.relativePath).toBe(".memoir/index.sqlite");
    expect(info.noteCount).toBeGreaterThan(0);
    expect(info.tagCount).toBeGreaterThan(0);
    await expect(gateway.rebuildIndex("demo://memoir")).resolves.toMatchObject({
      stats: { total: info.noteCount },
    });
  });

  it("stores pasted attachments in memory and resolves them as data URLs", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const saved = await gateway.saveAttachment("demo://memoir", {
      bytesBase64: "AAAA",
      fileName: "paste.png",
      mimeType: "image/png",
    });
    expect(saved.relativePath).toMatch(/^attachments\/\d{4}-\d{2}\/paste\.png$/);
    expect(await gateway.scanAttachments("demo://memoir")).toHaveLength(1);
    expect(gateway.resolveMediaPath(`demo://memoir/${saved.relativePath}`)).toMatch(
      /^data:image\/png;base64,AAAA$/,
    );
    await gateway.deleteAttachment("demo://memoir", saved.relativePath);
    expect(await gateway.scanAttachments("demo://memoir")).toEqual([]);
  });
});
