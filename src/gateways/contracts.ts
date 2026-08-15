import type { AppState, LegacyStatePayload, MigrationResult } from "../domain/app-state";
import type { AttachmentFile, SaveAttachmentInput } from "../domain/attachments";
import type { FolderAppearance } from "../domain/folders";
import type { NoteExtension, RawNoteFile } from "../domain/notes";
import type { AppSettings } from "../domain/settings";

export type CreateNoteInput = {
  root: string;
  title: string;
  extension: NoteExtension;
  folder?: string;
  tags?: string[];
};

export interface WorkspaceGateway {
  chooseWorkspace(title?: string): Promise<string | null>;
  scanWorkspace(root: string): Promise<RawNoteFile[]>;
  readNote(root: string, relativePath: string): Promise<string>;
  writeNote(root: string, relativePath: string, content: string): Promise<void>;
  createNote(input: CreateNoteInput): Promise<string>;
  renameNote(root: string, oldRelativePath: string, newRelativePath: string): Promise<string>;
  deleteNote(root: string, relativePath: string): Promise<string>;
  scanAttachments(root: string): Promise<AttachmentFile[]>;
  saveAttachment(root: string, input: SaveAttachmentInput): Promise<AttachmentFile>;
  importAttachments(root: string): Promise<AttachmentFile[]>;
  deleteAttachment(root: string, relativePath: string): Promise<string>;
  openPath(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  resolveMediaPath(path: string): string;
}

export interface PersistenceGateway {
  loadAppState(): Promise<AppState>;
  savePreferences(
    preferences: AppSettings,
    lastWorkspace: string | null,
    sidebarCollapsed: boolean,
  ): Promise<AppState>;
  setFavorite(workspaceRoot: string, relativePath: string, favorite: boolean): Promise<AppState>;
  setFolderAppearance(
    workspaceRoot: string,
    folder: string,
    appearance: FolderAppearance | null,
  ): Promise<AppState>;
  readDraft(workspaceRoot: string, relativePath: string): Promise<string | null>;
  writeDraft(workspaceRoot: string, relativePath: string, content: string): Promise<void>;
  deleteDraft(workspaceRoot: string, relativePath: string): Promise<void>;
  migrateLegacyState(payload: LegacyStatePayload): Promise<MigrationResult>;
}

export type AppGateways = {
  workspace: WorkspaceGateway;
  persistence: PersistenceGateway;
};
