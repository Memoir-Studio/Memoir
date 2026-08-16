import type { AppState, LegacyStatePayload, MigrationResult } from "../domain/app-state";
import type { AttachmentFile, SaveAttachmentInput } from "../domain/attachments";
import type { FolderAppearance } from "../domain/folders";
import type { WorkspaceIndexInfo } from "../domain/index-info";
import type {
  LibraryPage,
  LibraryQuery,
  NoteExtension,
  RawNoteFile,
  RenamedNote,
} from "../domain/notes";
import type { AppSettings } from "../domain/settings";
import type {
  CloudSyncProbe,
  CloudSyncProfile,
  CloudSyncProfileInput,
  CloudSyncRunResult,
} from "../domain/cloud-sync";

export type CreateNoteInput = {
  root: string;
  title: string;
  extension: NoteExtension;
  folder?: string;
  tags?: string[];
};

export interface WorkspaceGateway {
  chooseWorkspace(title?: string): Promise<string | null>;
  reconcileWorkspace(root: string, query?: LibraryQuery): Promise<LibraryPage>;
  queryLibrary(root: string, query: LibraryQuery): Promise<LibraryPage>;
  getIndexInfo(root: string): Promise<WorkspaceIndexInfo>;
  rebuildIndex(root: string, query?: LibraryQuery): Promise<LibraryPage>;
  readNote(root: string, relativePath: string): Promise<string>;
  writeNote(root: string, relativePath: string, content: string): Promise<RawNoteFile>;
  createNote(input: CreateNoteInput): Promise<RawNoteFile>;
  renameNote(root: string, oldRelativePath: string, newRelativePath: string): Promise<RenamedNote>;
  deleteNote(root: string, relativePath: string): Promise<string>;
  scanAttachments(root: string): Promise<AttachmentFile[]>;
  saveAttachment(root: string, input: SaveAttachmentInput): Promise<AttachmentFile>;
  importAttachments(root: string): Promise<AttachmentFile[]>;
  deleteAttachment(root: string, relativePath: string): Promise<string>;
  openPath(path: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  resolveMediaPath(path: string): string;
  chooseExportPath(input: { defaultPath: string; title?: string }): Promise<string | null>;
  writeExportFile(path: string, bytesBase64: string): Promise<void>;
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
  draftsExist(workspaceRoot: string, relativePaths: string[]): Promise<string[]>;
  migrateLegacyState(payload: LegacyStatePayload): Promise<MigrationResult>;
}

export interface CloudSyncGateway {
  getProfile(workspaceRoot: string): Promise<CloudSyncProfile>;
  saveProfile(workspaceRoot: string, profile: CloudSyncProfileInput): Promise<CloudSyncProfile>;
  testConnection(profile: CloudSyncProfileInput): Promise<CloudSyncProbe>;
  runSync(workspaceRoot: string, profile?: CloudSyncProfileInput): Promise<CloudSyncRunResult>;
}

export type AppGateways = {
  workspace: WorkspaceGateway;
  persistence: PersistenceGateway;
  cloudSync: CloudSyncGateway;
};
