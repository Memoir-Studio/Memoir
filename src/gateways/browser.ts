import type { AppState, LegacyStatePayload } from "../domain/app-state";
import { APP_STATE_VERSION } from "../domain/app-state";
import type { AttachmentFile, SaveAttachmentInput } from "../domain/attachments";
import {
  attachmentRelativePath,
  extensionFromFileName,
  extensionFromMime,
  mimeFromExtension,
  sanitizeAttachmentFileName,
} from "../domain/attachments";
import type { FolderAppearance } from "../domain/folders";
import { resolveWorkspaceFilePath } from "../domain/paths";
import {
  folderAppearancesForWorkspace,
  normalizeFolderAppearance,
  normalizeFolderKey,
} from "../domain/folders";
import { indexInfoFromNotes, type WorkspaceIndexInfo } from "../domain/index-info";
import type { LibraryPage, LibraryQuery, RawNoteFile, RenamedNote } from "../domain/notes";
import { parseNote, queryNotesInMemory } from "../features/library/note-utils";
import { DEFAULT_SETTINGS } from "../domain/settings";
import { GatewayError } from "../domain/errors";
import type { AppGateways, CreateNoteInput, PersistenceGateway, WorkspaceGateway } from "./contracts";

const DEMO_ROOT = "demo://memoir";
const DEMO_NOTES: Array<[string, string]> = [
  [
    "welcome.mdx",
    `---
title: Welcome to Memoir
tags: [memoir, mdx]
---

# Welcome to Memoir

This in-memory demo supports **Markdown**, MDX components, Mermaid, and editing.

<Callout type="tip" title="Browser demo">
  Browser preview never writes real app state to localStorage.
</Callout>
`,
  ],
  [
    "日记/today.md",
    `---
title: 今日记录
tags: [diary]
---

# 今日记录

写一点今天的事。
`,
  ],
  [
    "思考/inbox.md",
    `---
title: 随手记
tags: [ideas]
---

# 随手记

把念头先放在这里。
`,
  ],
  [
    "LeetCode/two-sum.md",
    `---
title: Two Sum
tags: [leetcode]
---

# Two Sum

Practice note for the classic problem.
`,
  ],
];

function yamlQuote(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function yamlTags(tags?: string[]) {
  const quoted = (tags ?? [])
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map(yamlQuote);
  return quoted.length ? `[${quoted.join(", ")}]` : "[]";
}

function createDefaultState(): AppState {
  return {
    version: APP_STATE_VERSION,
    preferences: DEFAULT_SETTINGS,
    recentWorkspaces: [],
    lastWorkspace: null,
    sidebarCollapsed: false,
    favorites: {},
    folderAppearances: {},
  };
}

export class BrowserWorkspaceGateway implements WorkspaceGateway {
  private files = new Map<string, string>(DEMO_NOTES);
  private modified = new Map<string, number>(DEMO_NOTES.map(([path]) => [path, Date.now()]));
  private attachments = new Map<string, AttachmentFile>();
  private media = new Map<string, string>();

  async chooseWorkspace(_title?: string) {
    return DEMO_ROOT;
  }

  private listNotes(): RawNoteFile[] {
    return [...this.files.entries()].map(([relativePath, content]) => {
      const fileName = relativePath.split("/").pop() || relativePath;
      const parsed = parseNote(content, fileName);
      return {
        relativePath,
        fileName,
        extension: relativePath.endsWith(".mdx") ? "mdx" : "md",
        modifiedMs: this.modified.get(relativePath) || Date.now(),
        size: new Blob([content]).size,
        title: parsed.title,
        tags: parsed.tags,
        excerpt: parsed.excerpt,
      };
    });
  }

  async queryLibrary(root: string, query: LibraryQuery): Promise<LibraryPage> {
    this.assertRoot(root);
    return queryNotesInMemory(this.listNotes(), query);
  }

  async reconcileWorkspace(root: string, query?: LibraryQuery): Promise<LibraryPage> {
    return this.queryLibrary(root, query ?? { q: "", nav: "all", folder: null, tag: null });
  }

  async getIndexInfo(root: string): Promise<WorkspaceIndexInfo> {
    const notes = this.listNotes();
    this.assertRoot(root);
    return indexInfoFromNotes(notes, {
      createdMs: Math.min(...notes.map((note) => note.modifiedMs)),
      lastReconcileMs: Date.now(),
    });
  }

  async rebuildIndex(root: string, query?: LibraryQuery) {
    return this.reconcileWorkspace(root, query);
  }

  async readNote(root: string, relativePath: string) {
    this.assertRoot(root);
    const content = this.files.get(relativePath);
    if (content === undefined) {
      throw new GatewayError({ code: "not_found", message: "Demo note does not exist." });
    }
    return content;
  }

  async writeNote(root: string, relativePath: string, content: string) {
    this.assertRoot(root);
    if (!this.files.has(relativePath)) {
      throw new GatewayError({ code: "not_found", message: "Demo note does not exist." });
    }
    this.files.set(relativePath, content);
    this.modified.set(relativePath, Date.now());
    return this.noteAt(relativePath);
  }

  async createNote({ root, title, extension, folder, tags }: CreateNoteInput) {
    this.assertRoot(root);
    const slug = title
      .trim()
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-|-$/g, "") || "untitled";
    const prefix = folder?.replace(/^\/|\/$/g, "");
    let index = 0;
    let relativePath = `${prefix ? `${prefix}/` : ""}${slug}.${extension}`;
    while (this.files.has(relativePath)) {
      index += 1;
      relativePath = `${prefix ? `${prefix}/` : ""}${slug}-${index}.${extension}`;
    }
    this.files.set(
      relativePath,
      `---\ntitle: ${yamlQuote(title)}\ntags: ${yamlTags(tags)}\n---\n\n# ${title}\n`,
    );
    this.modified.set(relativePath, Date.now());
    return this.noteAt(relativePath);
  }

  async renameNote(root: string, oldRelativePath: string, newRelativePath: string): Promise<RenamedNote> {
    this.assertRoot(root);
    const content = this.files.get(oldRelativePath);
    if (content === undefined) {
      throw new GatewayError({ code: "not_found", message: "Demo note does not exist." });
    }
    if (this.files.has(newRelativePath)) {
      throw new GatewayError({ code: "conflict", message: "A demo note already exists there." });
    }
    this.files.delete(oldRelativePath);
    this.files.set(newRelativePath, content);
    this.modified.set(newRelativePath, Date.now());
    return { oldPath: oldRelativePath, note: this.noteAt(newRelativePath) };
  }

  async deleteNote(root: string, relativePath: string) {
    this.assertRoot(root);
    if (!this.files.delete(relativePath)) {
      throw new GatewayError({ code: "not_found", message: "Demo note does not exist." });
    }
    return `.memoir-trash/${relativePath}`;
  }

  async scanAttachments(root: string) {
    this.assertRoot(root);
    return [...this.attachments.values()].sort(
      (left, right) => right.modifiedMs - left.modifiedMs || left.relativePath.localeCompare(right.relativePath),
    );
  }

  async saveAttachment(root: string, input: SaveAttachmentInput) {
    this.assertRoot(root);
    const extension =
      extensionFromFileName(input.fileName || "") || extensionFromMime(input.mimeType || "") || "png";
    const stem = sanitizeAttachmentFileName((input.fileName || "image").replace(/\.[^.]+$/, ""));
    let fileName = `${stem}.${extension}`;
    let index = 1;
    let relativePath = attachmentRelativePath(fileName);
    while (this.attachments.has(relativePath)) {
      fileName = `${stem}-${index}.${extension}`;
      relativePath = attachmentRelativePath(fileName);
      index += 1;
    }
    const attachment: AttachmentFile = {
      relativePath,
      fileName,
      extension,
      mimeType: mimeFromExtension(extension),
      modifiedMs: Date.now(),
      size: Math.ceil((input.bytesBase64.length * 3) / 4),
    };
    this.attachments.set(relativePath, attachment);
    const dataUrl = `data:${attachment.mimeType};base64,${input.bytesBase64}`;
    this.media.set(relativePath, dataUrl);
    this.media.set(resolveWorkspaceFilePath(DEMO_ROOT, relativePath), dataUrl);
    return attachment;
  }

  async importAttachments(root: string) {
    this.assertRoot(root);
    const files = await pickBrowserFiles();
    const imported: AttachmentFile[] = [];
    for (const file of files) {
      const bytesBase64 = await blobToBase64(file);
      imported.push(
        await this.saveAttachment(root, {
          bytesBase64,
          fileName: file.name,
          mimeType: file.type,
        }),
      );
    }
    return imported;
  }

  async deleteAttachment(root: string, relativePath: string) {
    this.assertRoot(root);
    if (!this.attachments.delete(relativePath)) {
      throw new GatewayError({ code: "not_found", message: "Demo attachment does not exist." });
    }
    this.media.delete(relativePath);
    this.media.delete(resolveWorkspaceFilePath(DEMO_ROOT, relativePath));
    return `.memoir-trash/${relativePath}`;
  }

  async openPath() {}

  async revealPath() {}

  async openExternal(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  resolveMediaPath(path: string) {
    return this.media.get(path) ?? path;
  }

  async chooseExportPath({ defaultPath }: { defaultPath: string; title?: string }) {
    return defaultPath.split(/[\\/]/).pop() || "note.pdf";
  }

  async writeExportFile(path: string, bytesBase64: string) {
    const fileName = path.split(/[\\/]/).pop() || "note.pdf";
    const binary = atob(bytesBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const anchor = document.createElement("a");
    anchor.download = fileName;
    anchor.href = url;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  private noteAt(relativePath: string): RawNoteFile {
    const content = this.files.get(relativePath) ?? "";
    const fileName = relativePath.split("/").pop() || relativePath;
    const parsed = parseNote(content, fileName);
    return {
      relativePath,
      fileName,
      extension: relativePath.endsWith(".mdx") ? "mdx" : "md",
      modifiedMs: this.modified.get(relativePath) || Date.now(),
      size: new Blob([content]).size,
      title: parsed.title,
      tags: parsed.tags,
      excerpt: parsed.excerpt,
    };
  }

  private assertRoot(root: string) {
    if (root !== DEMO_ROOT) {
      throw new GatewayError({ code: "invalid_path", message: "Browser mode only supports the demo workspace." });
    }
  }
}

export class BrowserPersistenceGateway implements PersistenceGateway {
  private state = createDefaultState();
  private drafts = new Map<string, string>();

  async loadAppState() {
    return structuredClone(this.state);
  }

  async savePreferences(
    preferences: AppState["preferences"],
    lastWorkspace: string | null,
    sidebarCollapsed: boolean,
  ) {
    this.state = {
      ...this.state,
      preferences,
      lastWorkspace,
      sidebarCollapsed,
      recentWorkspaces:
        lastWorkspace === DEMO_ROOT
          ? [DEMO_ROOT, ...this.state.recentWorkspaces.filter((root) => root !== DEMO_ROOT)]
          : this.state.recentWorkspaces,
    };
    return structuredClone(this.state);
  }

  async setFavorite(workspaceRoot: string, relativePath: string, favorite: boolean) {
    const current = new Set(this.state.favorites[workspaceRoot] || []);
    if (favorite) current.add(relativePath);
    else current.delete(relativePath);
    this.state = {
      ...this.state,
      favorites: { ...this.state.favorites, [workspaceRoot]: [...current] },
    };
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
    return this.drafts.get(`${workspaceRoot}\0${relativePath}`) ?? null;
  }

  async writeDraft(workspaceRoot: string, relativePath: string, content: string) {
    this.drafts.set(`${workspaceRoot}\0${relativePath}`, content);
  }

  async deleteDraft(workspaceRoot: string, relativePath: string) {
    this.drafts.delete(`${workspaceRoot}\0${relativePath}`);
  }

  async draftsExist(workspaceRoot: string, relativePaths: string[]) {
    return relativePaths.filter((relativePath) =>
      this.drafts.has(`${workspaceRoot}\0${relativePath}`),
    );
  }

  async migrateLegacyState(_payload: LegacyStatePayload) {
    return { migratedKeys: [] };
  }
}

function blobToBase64(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function pickBrowserFiles() {
  return new Promise<File[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.hidden = true;
    const finish = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => finish(Array.from(input.files ?? [])), { once: true });
    document.body.append(input);
    input.click();
  });
}

export function createBrowserGateways(): AppGateways {
  return {
    workspace: new BrowserWorkspaceGateway(),
    persistence: new BrowserPersistenceGateway(),
  };
}
