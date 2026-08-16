import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { markdownForAttachments } from "../domain/attachments";
import { resolveLocale, t } from "../i18n";
import { AUTOSAVE_INTERVAL_MS, createAppStore } from "./app-store";
import { createMockGateways } from "../test/mock-gateways";

function translated(store: ReturnType<typeof createAppStore>, key: "status.draftRestored" | "status.saved") {
  return t(resolveLocale(store.getState().settings.appearance.locale), key);
}

describe("app store actions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads workspace, restores draft, edits and saves through gateways", async () => {
    const gateways = createMockGateways();
    gateways.persistence.drafts.set("/workspace:one.md", "# Draft");
    const store = createAppStore(gateways);

    await store.getState().openWorkspace("/workspace");
    expect(store.getState().activePath).toBe("one.md");
    expect(store.getState().content).toBe("# Draft");
    expect(store.getState().status).toBe(translated(store, "status.draftRestored"));

    store.getState().setContent("# Edited");
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(gateways.persistence.drafts.get("/workspace:one.md")).toBe("# Edited");

    await store.getState().saveActiveNote();
    expect(gateways.workspace.writes).toEqual([{ path: "one.md", content: "# Edited" }]);
    expect(gateways.persistence.drafts.has("/workspace:one.md")).toBe(false);
    expect(store.getState().savedContent).toBe("# Edited");
  });

  it("keeps dirty content and exposes save failures", async () => {
    const gateways = createMockGateways();
    gateways.workspace.failWrite = true;
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    store.getState().setContent("# Unsaved");

    await store.getState().saveActiveNote();
    expect(store.getState().savedContent).not.toBe("# Unsaved");
    expect(store.getState().content).toBe("# Unsaved");
    expect(store.getState().error).toContain("disk full");
  });

  it("updates favorites and CRUD state", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    await store.getState().toggleFavorite();
    expect(store.getState().notes[0].favorite).toBe(true);
    expect(gateways.persistence.state.favorites["/workspace"]).toEqual(["one.md"]);

    await store.getState().createNote({ title: "Second", extension: "mdx" });
    expect(store.getState().activePath).toBe("second.mdx");

    await store.getState().renameActiveNote("renamed.mdx");
    expect(store.getState().activePath).toBe("renamed.mdx");

    await store.getState().deleteActiveNote();
    expect(store.getState().notes.some((note) => note.relativePath === "renamed.mdx")).toBe(
      false,
    );
  });

  it("rebuilds the workspace index then refreshes notes", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    await store.getState().rebuildIndex();
    expect(gateways.workspace.rebuildCount).toBe(1);
    expect(store.getState().error).toBe("");
    expect(store.getState().status).toBe(
      t(resolveLocale(store.getState().settings.appearance.locale), "status.indexRebuilt"),
    );

    gateways.workspace.failIndex = true;
    await store.getState().rebuildIndex();
    expect(store.getState().error).toContain("index locked");
  });

  it("saves and clears folder appearance for the current workspace", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    await store.getState().setFolderAppearance("日记", { emoji: "📔 日记", color: "coral" });
    expect(store.getState().folderAppearances).toEqual({
      日记: { emoji: "📔", color: "coral" },
    });
    expect(gateways.persistence.state.folderAppearances["/workspace"]).toEqual({
      日记: { emoji: "📔", color: "coral" },
    });

    await store.getState().setFolderAppearance("日记", null);
    expect(store.getState().folderAppearances).toEqual({});
    expect(gateways.persistence.state.folderAppearances["/workspace"]).toBeUndefined();
  });

  it("renames, favorites and deletes a note that is not active", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    await store.getState().createNote({ title: "Second", extension: "md" });
    await store.getState().selectNote("one.md");
    store.getState().setContent("# Keep editing");

    await store.getState().toggleFavorite("second.md");
    expect(store.getState().notes.find((note) => note.relativePath === "second.md")?.favorite).toBe(
      true,
    );
    expect(store.getState().activePath).toBe("one.md");
    expect(store.getState().content).toBe("# Keep editing");

    await store.getState().renameNote("second.md", "kept.md");
    expect(store.getState().activePath).toBe("one.md");
    expect(store.getState().content).toBe("# Keep editing");
    expect(store.getState().notes.some((note) => note.relativePath === "kept.md")).toBe(true);
    expect(gateways.persistence.state.favorites["/workspace"]).toEqual(["kept.md"]);

    await store.getState().deleteNote("kept.md");
    expect(store.getState().notes.some((note) => note.relativePath === "kept.md")).toBe(false);
    expect(store.getState().activePath).toBe("one.md");
    expect(store.getState().content).toBe("# Keep editing");
  });

  it("switches views, persists settings and reports successful save state", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    store.getState().setViewMode("preview");
    expect(store.getState().viewMode).toBe("preview");

    store.getState().setSettings({
      ...store.getState().settings,
      editor: {
        ...store.getState().settings.editor,
        fontSize: 17,
      },
    });
    vi.advanceTimersByTime(350);
    await Promise.resolve();
    expect(gateways.persistence.state.preferences.editor.fontSize).toBe(17);

    store.getState().setContent("# Saved");
    await store.getState().saveActiveNote();
    expect(store.getState().status).toBe(translated(store, "status.saved"));
    expect(store.getState().isSaving).toBe(false);
  });

  it("autosaves an open dirty note every 3 seconds", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    store.getState().setContent("# Autosave me");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS - 1);
    expect(gateways.workspace.writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(gateways.workspace.writes).toEqual([{ path: "one.md", content: "# Autosave me" }]);
    expect(store.getState().savedContent).toBe("# Autosave me");
    expect(store.getState().status).toBe(translated(store, "status.saved"));
    expect(store.getState().notes[0].dirty).toBe(false);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
    expect(gateways.workspace.writes).toHaveLength(1);
  });

  it("autosaves the latest dirty content on the 3s cadence", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    store.getState().setContent("# A");
    await vi.advanceTimersByTimeAsync(1500);
    store.getState().setContent("# AB");
    await vi.advanceTimersByTimeAsync(1500);

    expect(gateways.workspace.writes).toEqual([{ path: "one.md", content: "# AB" }]);
  });

  it("autosaves a restored draft only while that note stays open", async () => {
    const gateways = createMockGateways();
    gateways.persistence.drafts.set("/workspace:one.md", "# Draft");
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);
    expect(gateways.workspace.writes).toEqual([{ path: "one.md", content: "# Draft" }]);
    expect(gateways.persistence.drafts.has("/workspace:one.md")).toBe(false);
  });

  it("does not autosave after switching away from a dirty note", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    await store.getState().createNote({ title: "Second", extension: "md" });
    await store.getState().selectNote("one.md");

    store.getState().setContent("# Leave unsaved");
    await store.getState().selectNote("second.md");
    await vi.advanceTimersByTimeAsync(AUTOSAVE_INTERVAL_MS);

    expect(gateways.workspace.writes).toEqual([]);
    expect(gateways.persistence.drafts.get("/workspace:one.md")).toBe("# Leave unsaved");
    expect(store.getState().savedContent).toBe("# Second");
  });

  it("does not apply a finished save to a different note", async () => {
    const gateways = createMockGateways();
    let releaseWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const originalWrite = gateways.workspace.writeNote.bind(gateways.workspace);
    gateways.workspace.writeNote = async (root, path, content) => {
      await writeGate;
      return originalWrite(root, path, content);
    };

    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    await store.getState().createNote({ title: "Second", extension: "md" });
    await store.getState().selectNote("one.md");
    store.getState().setContent("# Old note");

    const savePromise = store.getState().saveActiveNote();
    await store.getState().selectNote("second.md");
    releaseWrite();
    await savePromise;

    expect(store.getState().activePath).toBe("second.md");
    expect(store.getState().content).toBe("# Second");
    expect(store.getState().savedContent).toBe("# Second");
    expect(gateways.workspace.writes).toEqual([{ path: "one.md", content: "# Old note" }]);
  });

  it("hydrates the library from scan metadata without reading every note", async () => {
    const gateways = createMockGateways();
    gateways.workspace.files.set("two.md", "# Two\n\nOther");
    gateways.persistence.drafts.set("/workspace:two.md", "# Draft Two");
    const readNote = vi.spyOn(gateways.workspace, "readNote");
    const readDraft = vi.spyOn(gateways.persistence, "readDraft");
    const store = createAppStore(gateways);

    await store.getState().openWorkspace("/workspace");

    expect(store.getState().notes.map((note) => note.relativePath).sort()).toEqual([
      "one.md",
      "two.md",
    ]);
    expect(store.getState().notes.find((note) => note.relativePath === "one.md")?.title).toBe("One");
    expect(store.getState().notes.find((note) => note.relativePath === "two.md")?.title).toBe(
      "Draft Two",
    );
    expect(store.getState().notes.find((note) => note.relativePath === "two.md")?.dirty).toBe(true);
    expect(readNote.mock.calls.map((call) => call[1])).toEqual(["one.md"]);
    expect(readDraft.mock.calls.map((call) => call[1]).sort()).toEqual(["one.md", "two.md"]);
  });

  it("keeps live editor metadata when reopening the current workspace", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    store.getState().setContent("# Keep editing live");

    await store.getState().openWorkspace("/workspace");
    expect(store.getState().content).toBe("# Keep editing live");
    expect(store.getState().notes[0].title).toBe("Keep editing live");
    expect(store.getState().notes[0].dirty).toBe(true);
  });

  it("injects persisted favorites into the first reconcile and reports stats", async () => {
    const gateways = createMockGateways();
    gateways.persistence.state.lastWorkspace = "/workspace";
    gateways.persistence.state.favorites = { "/workspace": ["one.md"] };
    const reconcile = vi.spyOn(gateways.workspace, "reconcileWorkspace");
    const store = createAppStore(gateways);

    await store.getState().initialize();

    expect(reconcile).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ favoritePaths: ["one.md"] }),
    );
    expect(store.getState().libraryStats.favorites).toBe(1);
    expect(store.getState().notes.find((note) => note.relativePath === "one.md")?.favorite).toBe(
      true,
    );
  });

  it("scans the last workspace on startup", async () => {
    const gateways = createMockGateways();
    gateways.persistence.state.lastWorkspace = "/workspace";
    const reconcile = vi.spyOn(gateways.workspace, "reconcileWorkspace");
    const store = createAppStore(gateways);

    await store.getState().initialize();

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith("/workspace", expect.any(Object));
    expect(store.getState().workspaceRoot).toBe("/workspace");
    expect(store.getState().notes.map((note) => note.relativePath)).toEqual(["one.md"]);
    expect(store.getState().activePath).toBe("one.md");
    expect(store.getState().initialized).toBe(true);
  });

  it("loads recent workspaces and keeps them when switching", async () => {
    const gateways = createMockGateways();
    gateways.persistence.state.lastWorkspace = "/workspace";
    gateways.persistence.state.recentWorkspaces = ["/workspace", "/archive"];
    const store = createAppStore(gateways);

    await store.getState().initialize();
    expect(store.getState().workspaceRoot).toBe("/workspace");
    expect(store.getState().recentWorkspaces).toEqual(["/workspace", "/archive"]);

    await store.getState().openWorkspace("/archive");
    expect(store.getState().workspaceRoot).toBe("/archive");
    expect(store.getState().recentWorkspaces).toEqual(["/archive", "/workspace"]);
  });

  it("flushes a dirty draft before switching workspaces", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    store.getState().setContent("# Unsaved burst");

    await store.getState().openWorkspace("/archive");
    expect(gateways.persistence.drafts.get("/workspace:one.md")).toBe("# Unsaved burst");
    expect(store.getState().workspaceRoot).toBe("/archive");
    expect(store.getState().content).not.toBe("# Unsaved burst");
  });

  it("does not reset the editor when reopening the current workspace", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    store.getState().setContent("# Keep editing");
    store.getState().setScopedFilter({ type: "folder", value: "日记" });

    await store.getState().openWorkspace("/workspace");
    expect(store.getState().content).toBe("# Keep editing");
    expect(store.getState().activePath).toBe("one.md");
    expect(store.getState().scopedFilter).toEqual({ type: "folder", value: "日记" });
  });

  it("saves pasted images into the attachment library and returns note-relative markdown", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");

    const saved = await store.getState().saveAttachments([
      { bytesBase64: "AAAA", fileName: "paste-1.png", mimeType: "image/png" },
    ]);
    expect(saved[0]?.relativePath).toMatch(
      /^\.memoir-attachments\/\d{4}-\d{2}\/paste-1\.png$/,
    );
    expect(store.getState().attachments.map((item) => item.relativePath)).toEqual([
      saved[0]?.relativePath,
    ]);
    expect(markdownForAttachments("日记/today.md", saved)).toBe(
      `![paste-1](../${saved[0]?.relativePath})`,
    );

    await store.getState().deleteAttachment(saved[0]!.relativePath);
    expect(store.getState().attachments).toEqual([]);
  });

  it("requires an open note before pasting images", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    store.setState({ activePath: null, loadedContentPath: null, content: "", savedContent: "" });

    const markdown = await store.getState().savePastedImages([
      new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" }),
    ]);
    expect(markdown).toBe("");
    expect(store.getState().error.length).toBeGreaterThan(0);
    expect(gateways.workspace.savedAttachments).toEqual([]);
  });

  it("does not reconcile or scan attachments on create rename delete or save", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    const reconcilesAfterOpen = gateways.workspace.reconcileCount;
    const attachmentsAfterOpen = gateways.workspace.scanAttachmentCount;
    const queryAfterOpen = gateways.workspace.queryLibraryCount;

    await store.getState().createNote({ title: "Second", extension: "md" });
    expect(store.getState().notes.some((note) => note.relativePath === "second.md")).toBe(true);
    expect(store.getState().notes.find((note) => note.relativePath === "second.md")?.title).toBe(
      "Second",
    );

    await store.getState().renameNote("second.md", "kept.md");
    expect(store.getState().notes.some((note) => note.relativePath === "kept.md")).toBe(true);

    await store.getState().deleteNote("kept.md");
    expect(store.getState().notes.some((note) => note.relativePath === "kept.md")).toBe(false);

    store.getState().setContent("# Saved locally");
    await store.getState().saveActiveNote();

    expect(gateways.workspace.reconcileCount).toBe(reconcilesAfterOpen);
    expect(gateways.workspace.scanAttachmentCount).toBe(attachmentsAfterOpen);
    expect(gateways.workspace.queryLibraryCount).toBeGreaterThan(queryAfterOpen);
    expect(store.getState().notes.find((note) => note.relativePath === "one.md")?.title).toBe(
      "Saved locally",
    );
  });

  it("rebuilds the index from the returned page without a follow-up reconcile", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    const reconcilesAfterOpen = gateways.workspace.reconcileCount;

    await store.getState().rebuildIndex();
    expect(gateways.workspace.rebuildCount).toBe(1);
    expect(gateways.workspace.reconcileCount).toBe(reconcilesAfterOpen);
    expect(store.getState().notes.map((note) => note.relativePath)).toEqual(["one.md"]);
  });

  it("queries the library after filter changes without reconciling", async () => {
    const gateways = createMockGateways();
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    const reconcilesAfterOpen = gateways.workspace.reconcileCount;
    const queriesAfterOpen = gateways.workspace.queryLibraryCount;

    store.getState().setNavFilter("uncategorized");
    await Promise.resolve();
    await Promise.resolve();

    expect(gateways.workspace.reconcileCount).toBe(reconcilesAfterOpen);
    expect(gateways.workspace.queryLibraryCount).toBeGreaterThan(queriesAfterOpen);
  });

  it("lists drafts once for the current page instead of probing every path", async () => {
    const gateways = createMockGateways();
    gateways.workspace.files.set("two.md", "# Two");
    const draftsExist = vi.spyOn(gateways.persistence, "draftsExist");
    const store = createAppStore(gateways);
    await store.getState().openWorkspace("/workspace");
    expect(draftsExist).toHaveBeenCalledTimes(1);
    expect(draftsExist.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(["one.md", "two.md"]));
  });
});
