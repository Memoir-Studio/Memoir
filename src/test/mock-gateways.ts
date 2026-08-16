import type { AppState } from "../domain/app-state";
import type { AttachmentFile, SaveAttachmentInput } from "../domain/attachments";
import { attachmentRelativePath, mimeFromExtension } from "../domain/attachments";
import type { FolderAppearance } from "../domain/folders";
import {
  folderAppearancesForWorkspace,
  normalizeFolderAppearance,
  normalizeFolderKey,
} from "../domain/folders";
import { indexInfoFromNotes, type WorkspaceIndexInfo } from "../domain/index-info";
import type { LibraryPage, LibraryQuery, RawNoteFile, RenamedNote } from "../domain/notes";
import { parseNote, queryNotesInMemory } from "../features/library/note-utils";
import { DEFAULT_SETTINGS } from "../domain/settings";
import {
  defaultCloudSyncProfile,
  mergeCloudSyncProfile,
  type CloudSyncProfile,
  type CloudSyncProfileInput,
  type CloudSyncProbe,
  type CloudSyncReport,
  type CloudSyncRunResult,
} from "../domain/cloud-sync";
import type {
  AppGateways,
  CloudSyncGateway,
  CreateNoteInput,
  PersistenceGateway,
  WorkspaceGateway,
} from "../gateways/contracts";

export class MockWorkspaceGateway implements WorkspaceGateway {
  files = new Map<string, string>([
    ["one.md", "---\ntitle: One\ntags: [test]\n---\n\n# One\n\nOriginal"],
  ]);
  attachments = new Map<string, AttachmentFile>();
  writes: Array<{ path: string; content: string }> = [];
  savedAttachments: SaveAttachmentInput[] = [];
  failWrite = false;
  failAttachment = false;
  nextImported: AttachmentFile[] = [];
  failIndex = false;
  rebuildCount = 0;
  reconcileCount = 0;
  queryLibraryCount = 0;
  scanAttachmentCount = 0;
  indexInfoOverrides: Partial<WorkspaceIndexInfo> = {};

  async chooseWorkspace(_title?: string) {
    return "/workspace";
  }

  private listNotes(): RawNoteFile[] {
    return [...this.files.entries()].map(([relativePath, content]) => {
      const fileName = relativePath.split("/").pop() || relativePath;
      const parsed = parseNote(content, fileName);
      return {
        relativePath,
        fileName,
        extension: relativePath.endsWith(".mdx") ? "mdx" : "md",
        modifiedMs: 1,
        size: content.length,
        title: parsed.title,
        tags: parsed.tags,
        excerpt: parsed.excerpt,
      };
    });
  }

  async queryLibrary(_root: string, query: LibraryQuery): Promise<LibraryPage> {
    this.queryLibraryCount += 1;
    return queryNotesInMemory(this.listNotes(), query);
  }

  async reconcileWorkspace(root: string, query?: LibraryQuery): Promise<LibraryPage> {
    this.reconcileCount += 1;
    return this.queryLibrary(root, query ?? { q: "", nav: "all", folder: null, tag: null });
  }

  async getIndexInfo(): Promise<WorkspaceIndexInfo> {
    if (this.failIndex) throw new Error("index locked");
    const notes = this.listNotes();
    return indexInfoFromNotes(notes, {
      persistent: true,
      fileSize: 4096,
      createdMs: 1,
      lastReconcileMs: 2,
      ...this.indexInfoOverrides,
    });
  }

  async rebuildIndex(root: string, query?: LibraryQuery) {
    this.rebuildCount += 1;
    if (this.failIndex) throw new Error("index locked");
    return this.queryLibrary(root, query ?? { q: "", nav: "all", folder: null, tag: null });
  }

  async readNote(_root: string, relativePath: string) {
    const content = this.files.get(relativePath);
    if (content === undefined) throw new Error("missing");
    return content;
  }

  async writeNote(_root: string, relativePath: string, content: string) {
    if (this.failWrite) throw new Error("disk full");
    this.files.set(relativePath, content);
    this.writes.push({ path: relativePath, content });
    return this.noteAt(relativePath);
  }

  async createNote(input: CreateNoteInput) {
    const relativePath = `${input.title.toLowerCase().replace(/\s+/g, "-")}.${input.extension}`;
    this.files.set(relativePath, `# ${input.title}`);
    return this.noteAt(relativePath);
  }

  async renameNote(_root: string, oldRelativePath: string, newRelativePath: string): Promise<RenamedNote> {
    const content = this.files.get(oldRelativePath) || "";
    this.files.delete(oldRelativePath);
    this.files.set(newRelativePath, content);
    return { oldPath: oldRelativePath, note: this.noteAt(newRelativePath) };
  }

  async deleteNote(_root: string, relativePath: string) {
    this.files.delete(relativePath);
    return `.memoir-trash/${relativePath}`;
  }

  async scanAttachments(): Promise<AttachmentFile[]> {
    this.scanAttachmentCount += 1;
    return [...this.attachments.values()];
  }

  async saveAttachment(_root: string, input: SaveAttachmentInput) {
    if (this.failAttachment) throw new Error("attachment disk full");
    this.savedAttachments.push(input);
    const fileName = input.fileName || "paste.png";
    const relativePath = attachmentRelativePath(fileName);
    const attachment: AttachmentFile = {
      relativePath,
      fileName,
      extension: fileName.split(".").pop() || "png",
      mimeType: input.mimeType || mimeFromExtension(fileName.split(".").pop() || "png"),
      modifiedMs: Date.now(),
      size: 12,
    };
    this.attachments.set(relativePath, attachment);
    return attachment;
  }

  importedPaths: string[] = [];

  async importAttachments() {
    if (this.failAttachment) throw new Error("attachment disk full");
    for (const attachment of this.nextImported) {
      this.attachments.set(attachment.relativePath, attachment);
    }
    return [...this.nextImported];
  }

  async importAttachmentsFromPaths(_root: string, sourcePaths: string[]) {
    if (this.failAttachment) throw new Error("attachment disk full");
    this.importedPaths.push(...sourcePaths);
    const imported: AttachmentFile[] = [];
    for (const sourcePath of sourcePaths) {
      const fileName = sourcePath.split(/[\\/]/).pop() || "drop.png";
      const relativePath = attachmentRelativePath(fileName);
      const attachment: AttachmentFile = {
        relativePath,
        fileName,
        extension: fileName.split(".").pop() || "png",
        mimeType: mimeFromExtension(fileName.split(".").pop() || "png"),
        modifiedMs: Date.now(),
        size: 12,
      };
      this.attachments.set(relativePath, attachment);
      imported.push(attachment);
    }
    return imported;
  }

  async deleteAttachment(_root: string, relativePath: string) {
    this.attachments.delete(relativePath);
    return `.memoir-trash/${relativePath}`;
  }

  async openPath(_path: string) {}
  async revealPath(_path: string) {}
  async openExternal(_url?: string) {}
  resolveMediaPath(path: string) {
    return path;
  }

  nextExportPath: string | null = "/tmp/note.pdf";
  savedExports: Array<{ path: string; bytesBase64: string }> = [];

  async chooseExportPath({ defaultPath }: { defaultPath: string; title?: string }) {
    if (this.nextExportPath === null) return null;
    return this.nextExportPath || defaultPath;
  }

  async writeExportFile(path: string, bytesBase64: string) {
    this.savedExports.push({ path, bytesBase64 });
  }

  private noteAt(relativePath: string): RawNoteFile {
    const content = this.files.get(relativePath) ?? "";
    const fileName = relativePath.split("/").pop() || relativePath;
    const parsed = parseNote(content, fileName);
    return {
      relativePath,
      fileName,
      extension: relativePath.endsWith(".mdx") ? "mdx" : "md",
      modifiedMs: 1,
      size: content.length,
      title: parsed.title,
      tags: parsed.tags,
      excerpt: parsed.excerpt,
    };
  }
}

export class MockPersistenceGateway implements PersistenceGateway {
  state: AppState = {
    version: 1,
    preferences: DEFAULT_SETTINGS,
    recentWorkspaces: [],
    lastWorkspace: null,
    sidebarCollapsed: false,
    favorites: {},
    folderAppearances: {},
  };
  drafts = new Map<string, string>();

  async loadAppState() {
    return structuredClone(this.state);
  }

  async savePreferences(
    preferences: AppState["preferences"],
    lastWorkspace: string | null,
    sidebarCollapsed: boolean,
  ) {
    let recentWorkspaces = this.state.recentWorkspaces;
    if (lastWorkspace) {
      recentWorkspaces = [
        lastWorkspace,
        ...this.state.recentWorkspaces.filter((root) => root !== lastWorkspace),
      ].slice(0, 10);
    }
    this.state = {
      ...this.state,
      preferences,
      lastWorkspace,
      sidebarCollapsed,
      recentWorkspaces,
    };
    return structuredClone(this.state);
  }

  async setFavorite(workspaceRoot: string, relativePath: string, favorite: boolean) {
    const values = new Set(this.state.favorites[workspaceRoot] || []);
    if (favorite) values.add(relativePath);
    else values.delete(relativePath);
    this.state.favorites[workspaceRoot] = [...values];
    return structuredClone(this.state);
  }

  async setFolderAppearance(
    workspaceRoot: string,
    folder: string,
    appearance: FolderAppearance | null,
  ) {
    const key = normalizeFolderKey(folder);
    const current = folderAppearancesForWorkspace(this.state.folderAppearances, workspaceRoot);
    const nextAppearance = appearance ? normalizeFolderAppearance(appearance) : undefined;
    if (nextAppearance) current[key] = nextAppearance;
    else delete current[key];
    const folderAppearances = { ...this.state.folderAppearances };
    if (Object.keys(current).length) folderAppearances[workspaceRoot] = current;
    else delete folderAppearances[workspaceRoot];
    this.state = { ...this.state, folderAppearances };
    return structuredClone(this.state);
  }

  async readDraft(workspaceRoot: string, relativePath: string) {
    return this.drafts.get(`${workspaceRoot}:${relativePath}`) ?? null;
  }

  async writeDraft(workspaceRoot: string, relativePath: string, content: string) {
    this.drafts.set(`${workspaceRoot}:${relativePath}`, content);
  }

  async deleteDraft(workspaceRoot: string, relativePath: string) {
    this.drafts.delete(`${workspaceRoot}:${relativePath}`);
  }

  async draftsExist(workspaceRoot: string, relativePaths: string[]) {
    return relativePaths.filter((relativePath) =>
      this.drafts.has(`${workspaceRoot}:${relativePath}`),
    );
  }

  async migrateLegacyState() {
    return { migratedKeys: [] };
  }
}

export class MockCloudSyncGateway implements CloudSyncGateway {
  profiles = new Map<string, CloudSyncProfile>();
  lastTest: CloudSyncProfileInput | null = null;
  lastRun: { root: string; profile?: CloudSyncProfileInput } | null = null;
  failTest = false;
  failRun = false;
  nextProbe: CloudSyncProbe = { ok: true, message: "Connected." };
  nextReport: CloudSyncReport = {
    uploaded: 1,
    downloaded: 0,
    deletedRemote: 0,
    deletedLocal: 0,
    skipped: 2,
    conflicts: 0,
    errors: [],
    completedMs: 1_700_000_000_000,
  };

  async getProfile(workspaceRoot: string) {
    return mergeCloudSyncProfile(this.profiles.get(workspaceRoot) ?? defaultCloudSyncProfile());
  }

  async saveProfile(workspaceRoot: string, profile: CloudSyncProfileInput) {
    const current = await this.getProfile(workspaceRoot);
    const next = mergeCloudSyncProfile({ ...current, ...profile });
    this.profiles.set(workspaceRoot, next);
    return next;
  }

  async testConnection(profile: CloudSyncProfileInput) {
    this.lastTest = profile;
    if (this.failTest) throw new Error("unauthorized");
    return this.nextProbe;
  }

  async runSync(workspaceRoot: string, profile?: CloudSyncProfileInput): Promise<CloudSyncRunResult> {
    this.lastRun = { root: workspaceRoot, profile };
    if (this.failRun) throw new Error("sync failed");
    if (profile) {
      await this.saveProfile(workspaceRoot, profile);
    }
    const saved = await this.getProfile(workspaceRoot);
    const next = mergeCloudSyncProfile({
      ...saved,
      lastSyncMs: this.nextReport.completedMs,
      lastStatus: "ok",
      lastError: null,
      lastReport: this.nextReport,
    });
    this.profiles.set(workspaceRoot, next);
    return { profile: next, report: this.nextReport };
  }
}

export function createMockGateways(): AppGateways & {
  workspace: MockWorkspaceGateway;
  persistence: MockPersistenceGateway;
  cloudSync: MockCloudSyncGateway;
} {
  return {
    workspace: new MockWorkspaceGateway(),
    persistence: new MockPersistenceGateway(),
    cloudSync: new MockCloudSyncGateway(),
  };
}
