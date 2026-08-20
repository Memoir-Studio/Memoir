import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const open = vi.fn();
const save = vi.fn();
const openPath = vi.fn();
const revealItemInDir = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open, save }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath,
  openUrl: vi.fn(),
  revealItemInDir,
}));

describe("Tauri gateways", () => {
  beforeEach(() => {
    invoke.mockReset();
    open.mockReset();
    save.mockReset();
    openPath.mockReset();
    revealItemInDir.mockReset();
  });

  it("uses camelCase DTOs for workspace commands", async () => {
    const { TauriWorkspaceGateway } = await import("./tauri");
    invoke.mockResolvedValue("new-note.md");
    const gateway = new TauriWorkspaceGateway();
    await gateway.createNote({
      root: "/notes",
      title: "New",
      extension: "md",
      folder: "work",
      tags: ["team"],
    });
    expect(invoke).toHaveBeenCalledWith("create_note", {
      root: "/notes",
      title: "New",
      extension: "md",
      folder: "work",
      tags: ["team"],
    });
  });

  it("loads and rebuilds the workspace index with camelCase DTOs", async () => {
    const { TauriWorkspaceGateway } = await import("./tauri");
    const info = {
      persistent: true,
      relativePath: ".memoir/index.sqlite",
      fileSize: 12,
      walSize: 0,
      shmSize: 0,
      schemaVersion: 2,
      schemaName: "memoir-index",
      parseAlgoVersion: 1,
      indexReadCap: 1024,
      createdMs: 1,
      lastReconcileMs: 2,
      noteCount: 3,
      tagCount: 1,
      tagLinkCount: 1,
      truncatedCount: 0,
    };
    const page = {
      notes: [],
      stats: {
        total: 0,
        recent: 0,
        favorites: 0,
        uncategorized: 0,
        folders: [],
        tags: [],
        truncated: false,
      },
    };
    invoke.mockResolvedValueOnce(info);
    const gateway = new TauriWorkspaceGateway();
    await expect(gateway.getIndexInfo("/notes")).resolves.toEqual(info);
    expect(invoke).toHaveBeenCalledWith("get_index_info", { root: "/notes" });
    invoke.mockResolvedValueOnce(page);
    await expect(gateway.rebuildIndex("/notes")).resolves.toEqual(page);
    expect(invoke).toHaveBeenCalledWith("rebuild_index", { root: "/notes", query: undefined });
  });

  it("sends library query DTOs for reconcile and query", async () => {
    const { TauriWorkspaceGateway } = await import("./tauri");
    const page = {
      notes: [],
      stats: {
        total: 0,
        recent: 0,
        favorites: 0,
        uncategorized: 0,
        folders: [],
        tags: [],
        truncated: false,
      },
    };
    invoke.mockResolvedValue(page);
    const gateway = new TauriWorkspaceGateway();
    const query = { q: "hi", nav: "all" as const, folder: null, tag: null, favoritePaths: [] };
    await expect(gateway.reconcileWorkspace("/notes", query)).resolves.toEqual(page);
    expect(invoke).toHaveBeenCalledWith("reconcile_workspace", { root: "/notes", query });
    await expect(gateway.queryLibrary("/notes", query)).resolves.toEqual(page);
    expect(invoke).toHaveBeenCalledWith("query_library", { root: "/notes", query });
  });

  it("imports dropped files through the existing attachment command", async () => {
    const { TauriWorkspaceGateway } = await import("./tauri");
    invoke.mockResolvedValue({
      relativePath: "attachments/2026-08/shot.png",
      fileName: "shot.png",
      extension: "png",
      mimeType: "image/png",
      modifiedMs: 1,
      size: 12,
    });
    const gateway = new TauriWorkspaceGateway();
    await gateway.importAttachmentsFromPaths("/notes", ["/tmp/shot.png"]);
    expect(invoke).toHaveBeenCalledWith("import_attachment", {
      root: "/notes",
      sourcePath: "/tmp/shot.png",
    });
  });

  it("saves attachments with camelCase DTOs", async () => {
    const { TauriWorkspaceGateway } = await import("./tauri");
    invoke.mockResolvedValue({
      relativePath: "attachments/paste.png",
      fileName: "paste.png",
      extension: "png",
      mimeType: "image/png",
      modifiedMs: 1,
      size: 12,
    });
    const gateway = new TauriWorkspaceGateway();
    await gateway.saveAttachment("/notes", {
      bytesBase64: "AAAA",
      fileName: "paste.png",
      mimeType: "image/png",
    });
    expect(invoke).toHaveBeenCalledWith("save_attachment", {
      root: "/notes",
      bytesBase64: "AAAA",
      fileName: "paste.png",
      mimeType: "image/png",
    });
  });

  it("maps structured command errors", async () => {
    const { TauriWorkspaceGateway } = await import("./tauri");
    invoke.mockRejectedValue({
      code: "invalid_path",
      message: "Outside workspace",
      details: "../note.md",
    });
    const gateway = new TauriWorkspaceGateway();
    await expect(gateway.readNote("/notes", "../note.md")).rejects.toMatchObject({
      name: "GatewayError",
      code: "invalid_path",
      message: "Outside workspace",
      details: "../note.md",
    });
  });

  it("checks for app updates and skips a version", async () => {
    const { TauriPersistenceGateway } = await import("./tauri");
    const result = {
      status: "available",
      currentVersion: "0.1.6",
      latestVersion: "0.1.7",
      releaseUrl: "https://github.com/Memoir-Studio/Memoir/releases/tag/v0.1.7",
      releaseNotes: "Fixes a crash.",
    };
    invoke.mockResolvedValueOnce(result);
    const gateway = new TauriPersistenceGateway();
    await expect(gateway.checkAppUpdate()).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith("check_app_update", undefined);
    invoke.mockResolvedValueOnce(undefined);
    await gateway.skipAppUpdate("0.1.7");
    expect(invoke).toHaveBeenCalledWith("skip_app_update", { version: "0.1.7" });
  });

  it("sends folder appearance updates with camelCase DTOs", async () => {
    const { TauriPersistenceGateway } = await import("./tauri");
    invoke.mockResolvedValue({ folderAppearances: {} });
    const gateway = new TauriPersistenceGateway();
    await gateway.setFolderAppearance("/notes", "日记", { emoji: "📔", color: "coral" });
    expect(invoke).toHaveBeenCalledWith("set_folder_appearance", {
      workspaceRoot: "/notes",
      folder: "日记",
      appearance: { emoji: "📔", color: "coral" },
    });
  });

  it("saves a PDF export to the chosen path", async () => {
    const { TauriWorkspaceGateway } = await import("./tauri");
    save.mockResolvedValue("/tmp/two");
    invoke.mockResolvedValue(undefined);
    const gateway = new TauriWorkspaceGateway();
    const path = await gateway.chooseExportPath({ defaultPath: "/notes/two.pdf", title: "导出 PDF" });
    expect(path).toBe("/tmp/two.pdf");
    await gateway.writeExportFile(path!, "AAAA");
    expect(invoke).toHaveBeenCalledWith("write_export_file", {
      path: "/tmp/two.pdf",
      bytesBase64: "AAAA",
    });
  });

  it("reveals a path in the system file manager", async () => {
    const { TauriWorkspaceGateway } = await import("./tauri");
    revealItemInDir.mockResolvedValue(undefined);
    const gateway = new TauriWorkspaceGateway();
    await gateway.revealPath("/notes/one.md");
    expect(revealItemInDir).toHaveBeenCalledWith("/notes/one.md");
  });

  it("sends cloud sync commands with camelCase DTOs", async () => {
    const { TauriCloudSyncGateway } = await import("./tauri");
    const profile = {
      enabled: true,
      provider: "webdav" as const,
      remotePrefix: "Memoir",
      webdav: { url: "https://dav.example/dav", username: "ada", password: "secret", insecureTls: false },
    };
    invoke.mockResolvedValueOnce({ ...profile, lastSyncMs: null, lastStatus: "idle", lastError: null, lastReport: null });
    const gateway = new TauriCloudSyncGateway();
    await gateway.saveProfile("/notes", profile);
    expect(invoke).toHaveBeenCalledWith("save_cloud_sync_profile", {
      workspaceRoot: "/notes",
      profile,
    });
    invoke.mockResolvedValueOnce({ ok: true, message: "Connected." });
    await expect(gateway.testConnection(profile)).resolves.toEqual({ ok: true, message: "Connected." });
    expect(invoke).toHaveBeenCalledWith("test_cloud_sync", { profile });
    invoke.mockResolvedValueOnce({
      profile: { ...profile, lastStatus: "ok" },
      report: { uploaded: 1, downloaded: 0, deletedRemote: 0, deletedLocal: 0, skipped: 0, conflicts: 0, errors: [], completedMs: 1, durationMs: 4, changedLocalPaths: [] },
    });
    await gateway.runSync("/notes", profile);
    expect(invoke).toHaveBeenCalledWith("run_cloud_sync", { workspaceRoot: "/notes", profile });
  });

  it("asks draftsExist with camelCase arguments", async () => {
    const { TauriPersistenceGateway } = await import("./tauri");
    invoke.mockResolvedValue(["one.md"]);
    const gateway = new TauriPersistenceGateway();
    await expect(gateway.draftsExist("/notes", ["one.md", "two.md"])).resolves.toEqual(["one.md"]);
    expect(invoke).toHaveBeenCalledWith("drafts_exist", {
      workspaceRoot: "/notes",
      relativePaths: ["one.md", "two.md"],
    });
  });
});
