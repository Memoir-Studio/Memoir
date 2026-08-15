import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const open = vi.fn();
const save = vi.fn();
const openPath = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke,
  convertFileSrc: (path: string) => `asset://${path}`,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open, save }));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openPath,
  openUrl: vi.fn(),
}));

describe("Tauri gateways", () => {
  beforeEach(() => {
    invoke.mockReset();
    open.mockReset();
    save.mockReset();
    openPath.mockReset();
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
