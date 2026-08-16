import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import type { AppState, LegacyStatePayload, MigrationResult } from "../domain/app-state";
import type { AttachmentFile, SaveAttachmentInput } from "../domain/attachments";
import { ATTACHMENT_EXTENSIONS } from "../domain/attachments";
import type { FolderAppearance } from "../domain/folders";
import type { WorkspaceIndexInfo } from "../domain/index-info";
import type { RawNoteFile } from "../domain/notes";
import type { AppSettings } from "../domain/settings";
import { mapGatewayError } from "../domain/errors";
import type { AppGateways, CreateNoteInput, PersistenceGateway, WorkspaceGateway } from "./contracts";

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw mapGatewayError(error);
  }
}

export class TauriWorkspaceGateway implements WorkspaceGateway {
  async chooseWorkspace(title?: string) {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: title || "Choose a notes folder",
    });
    return typeof selected === "string" ? selected : null;
  }

  scanWorkspace(root: string) {
    return call<RawNoteFile[]>("scan_workspace", { root });
  }

  getIndexInfo(root: string) {
    return call<WorkspaceIndexInfo>("get_index_info", { root });
  }

  rebuildIndex(root: string) {
    return call<WorkspaceIndexInfo>("rebuild_index", { root });
  }

  readNote(root: string, relativePath: string) {
    return call<string>("read_note", { root, relativePath });
  }

  writeNote(root: string, relativePath: string, content: string) {
    return call<void>("write_note", { root, relativePath, content });
  }

  createNote({ root, title, extension, folder, tags }: CreateNoteInput) {
    return call<string>("create_note", { root, title, extension, folder, tags });
  }

  renameNote(root: string, oldRelativePath: string, newRelativePath: string) {
    return call<string>("rename_note", { root, oldRelativePath, newRelativePath });
  }

  deleteNote(root: string, relativePath: string) {
    return call<string>("delete_note", { root, relativePath });
  }

  scanAttachments(root: string) {
    return call<AttachmentFile[]>("scan_attachments", { root });
  }

  saveAttachment(root: string, input: SaveAttachmentInput) {
    return call<AttachmentFile>("save_attachment", {
      root,
      bytesBase64: input.bytesBase64,
      fileName: input.fileName,
      mimeType: input.mimeType,
    });
  }

  async importAttachments(root: string) {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: "Images", extensions: [...ATTACHMENT_EXTENSIONS] }],
    });
    if (!selected) return [];
    const paths = Array.isArray(selected) ? selected : [selected];
    const imported: AttachmentFile[] = [];
    for (const sourcePath of paths) {
      imported.push(await call<AttachmentFile>("import_attachment", { root, sourcePath }));
    }
    return imported;
  }

  deleteAttachment(root: string, relativePath: string) {
    return call<string>("delete_attachment", { root, relativePath });
  }

  async openPath(path: string) {
    try {
      await openPath(path);
    } catch (error) {
      throw mapGatewayError(error);
    }
  }

  async revealPath(path: string) {
    try {
      await revealItemInDir(path);
    } catch (error) {
      throw mapGatewayError(error);
    }
  }

  async openExternal(url: string) {
    try {
      await openUrl(url);
    } catch (error) {
      throw mapGatewayError(error);
    }
  }

  resolveMediaPath(path: string) {
    return convertFileSrc(path);
  }

  async chooseExportPath({ defaultPath, title }: { defaultPath: string; title?: string }) {
    const selected = await saveDialog({
      defaultPath,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      title: title || "Export PDF",
    });
    if (typeof selected !== "string" || !selected) return null;
    return selected.toLowerCase().endsWith(".pdf") ? selected : `${selected}.pdf`;
  }

  writeExportFile(path: string, bytesBase64: string) {
    return call<void>("write_export_file", { path, bytesBase64 });
  }
}

export class TauriPersistenceGateway implements PersistenceGateway {
  loadAppState() {
    return call<AppState>("load_app_state");
  }

  savePreferences(
    preferences: AppSettings,
    lastWorkspace: string | null,
    sidebarCollapsed: boolean,
  ) {
    return call<AppState>("save_preferences", {
      preferences,
      lastWorkspace,
      sidebarCollapsed,
    });
  }

  setFavorite(workspaceRoot: string, relativePath: string, favorite: boolean) {
    return call<AppState>("set_favorite", { workspaceRoot, relativePath, favorite });
  }

  setFolderAppearance(
    workspaceRoot: string,
    folder: string,
    appearance: FolderAppearance | null,
  ) {
    return call<AppState>("set_folder_appearance", { workspaceRoot, folder, appearance });
  }

  readDraft(workspaceRoot: string, relativePath: string) {
    return call<string | null>("read_draft", { workspaceRoot, relativePath });
  }

  writeDraft(workspaceRoot: string, relativePath: string, content: string) {
    return call<void>("write_draft", { workspaceRoot, relativePath, content });
  }

  deleteDraft(workspaceRoot: string, relativePath: string) {
    return call<void>("delete_draft", { workspaceRoot, relativePath });
  }

  draftsExist(workspaceRoot: string, relativePaths: string[]) {
    return call<string[]>("drafts_exist", { workspaceRoot, relativePaths });
  }

  migrateLegacyState(payload: LegacyStatePayload) {
    return call<MigrationResult>("migrate_legacy_state", { payload });
  }
}

export function createTauriGateways(): AppGateways {
  return {
    workspace: new TauriWorkspaceGateway(),
    persistence: new TauriPersistenceGateway(),
  };
}
