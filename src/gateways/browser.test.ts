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
  it("creates and keeps an empty folder in library stats", async () => {
    const gateway = new BrowserWorkspaceGateway();
    await expect(gateway.createFolder("demo://memoir", "工作/项目")).resolves.toBe("工作/项目");

    const page = await gateway.queryLibrary("demo://memoir", {
      q: "",
      nav: "all",
      folder: null,
      tag: null,
    });
    expect(page.stats.folders).toEqual(
      expect.arrayContaining([
        { folder: "工作", count: 0 },
        { folder: "工作/项目", count: 0 },
      ]),
    );
  });

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

  it("returns a note graph for wiki and markdown references", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const graph = await gateway.getNoteGraph("demo://memoir");
    expect(graph.nodes.length).toBeGreaterThan(1);
    expect(
      graph.edges.some(
        (edge) =>
          edge.sourcePath === "welcome.mdx" &&
          edge.targetRef === "Two Sum" &&
          edge.targetPath === "LeetCode/two-sum.md",
      ),
    ).toBe(true);
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

  it("rejects non-http URLs before fetching a link preview", async () => {
    const gateway = new BrowserWorkspaceGateway();
    await expect(gateway.fetchLinkPreviewHtml("file:///tmp/note.md")).rejects.toMatchObject({
      code: "invalid_path",
    });
  });

  it("reads link preview HTML from fetch", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><title>Hello</title></html>", { status: 200 }),
    );
    await expect(gateway.fetchLinkPreviewHtml("https://example.com")).resolves.toContain("Hello");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" } }),
    );
    fetchMock.mockRestore();
  });

  it("holds a note conversation through an OpenAI-compatible chat endpoint", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        choices: [{
          message: {
            content:
              '```json\n{"message":"Updated it.","edit":{"tool":"replace_selection","replacement":"  - revised\\n"}}\n```',
          },
        }],
      }),
    );

    await expect(
      gateway.chatWithNote(
        {
          enabled: true,
          provider: "openai",
          baseUrl: "https://api.example.com/v1/",
          apiKey: "secret",
          embeddingModel: "embedding",
          rerankingModel: "",
          chatModel: "chat-model",
        },
        [{ role: "user", content: "Polish it" }],
        {
          path: "notes/example.md",
          from: 2,
          to: 15,
          source: "  - original\n",
          scope: "selection",
        },
      ),
    ).resolves.toEqual({
      message: "Updated it.",
      edit: { tool: "replace_selection", replacement: "  - revised\n" },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "chat-model",
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "user", content: "Polish it" }),
      ]),
    });
    fetchMock.mockRestore();
  });
});
