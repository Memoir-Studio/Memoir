import type { AppState } from "../domain/app-state";
import type { FolderAppearance } from "../domain/folders";
import {
  folderAppearancesForWorkspace,
  normalizeFolderAppearance,
  normalizeFolderKey,
} from "../domain/folders";
import type { RawNoteFile } from "../domain/notes";
import { DEFAULT_SETTINGS } from "../domain/settings";
import type {
  AppGateways,
  CreateNoteInput,
  PersistenceGateway,
  WorkspaceGateway,
} from "../gateways/contracts";

export class MockWorkspaceGateway implements WorkspaceGateway {
  files = new Map<string, string>([
    ["one.md", "---\ntitle: One\ntags: [test]\n---\n\n# One\n\nOriginal"],
  ]);
  writes: Array<{ path: string; content: string }> = [];
  failWrite = false;

  async chooseWorkspace(_title?: string) {
    return "/workspace";
  }

  async scanWorkspace(): Promise<RawNoteFile[]> {
    return [...this.files.entries()].map(([relativePath, content]) => ({
      relativePath,
      fileName: relativePath,
      extension: relativePath.endsWith(".mdx") ? "mdx" : "md",
      modifiedMs: 1,
      size: content.length,
    }));
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
  }

  async createNote(input: CreateNoteInput) {
    const relativePath = `${input.title.toLowerCase().replace(/\s+/g, "-")}.${input.extension}`;
    this.files.set(relativePath, `# ${input.title}`);
    return relativePath;
  }

  async renameNote(_root: string, oldRelativePath: string, newRelativePath: string) {
    const content = this.files.get(oldRelativePath) || "";
    this.files.delete(oldRelativePath);
    this.files.set(newRelativePath, content);
    return newRelativePath;
  }

  async deleteNote(_root: string, relativePath: string) {
    this.files.delete(relativePath);
    return `.memoir-trash/${relativePath}`;
  }

  async openPath() {}
  async openExternal() {}
  resolveMediaPath(path: string) {
    return path;
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

  async migrateLegacyState() {
    return { migratedKeys: [] };
  }
}

export function createMockGateways(): AppGateways & {
  workspace: MockWorkspaceGateway;
  persistence: MockPersistenceGateway;
} {
  return {
    workspace: new MockWorkspaceGateway(),
    persistence: new MockPersistenceGateway(),
  };
}
