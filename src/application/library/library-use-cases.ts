import type { AppGateways } from "../../gateways/contracts";
import type { AttachmentFile } from "../../domain/attachments";
import { folderAppearancesForWorkspace } from "../../domain/folders";
import { parseNote } from "../../domain/notes/note-utils";
import type { LibraryPage, NoteMeta } from "../../domain/notes";

export type LibraryProjection = {
  notes: NoteMeta[];
  favoritePaths: string[];
  folderAppearances: ReturnType<typeof folderAppearancesForWorkspace>;
};

export type WorkspaceSnapshot = {
  page: LibraryPage;
  attachments: AttachmentFile[];
};

export async function loadWorkspaceSnapshot(
  gateways: AppGateways,
  root: string,
  query: Parameters<AppGateways["workspace"]["reconcileWorkspace"]>[1],
): Promise<WorkspaceSnapshot> {
  const [page, attachments] = await Promise.all([
    gateways.workspace.reconcileWorkspace(root, query),
    gateways.attachments.scanAttachments(root),
  ]);
  return { page, attachments };
}

function favoriteSet(favorites: Record<string, string[]>, root: string) {
  return new Set(favorites[root] || []);
}

/** Loads persisted decorations and drafts for one already-queried library page. */
export async function prepareLibraryProjection(
  gateways: AppGateways,
  root: string,
  page: LibraryPage,
): Promise<LibraryProjection> {
  const appState = await gateways.persistence.loadAppState();
  const favorites = favoriteSet(appState.favorites, root);
  const draftPaths = await gateways.persistence.draftsExist(
    root,
    page.notes.map((file) => file.relativePath),
  );
  const draftSet = new Set(draftPaths);
  const notes = await Promise.all(
    page.notes.map(async (file): Promise<NoteMeta> => {
      const favorite = favorites.has(file.relativePath);
      if (!draftSet.has(file.relativePath)) return { ...file, favorite, dirty: false };
      try {
        const draft = await gateways.persistence.readDraft(root, file.relativePath);
        if (draft == null) return { ...file, favorite, dirty: false };
        return { ...file, ...parseNote(draft, file.fileName), favorite, dirty: true };
      } catch {
        return {
          ...file,
          title: file.fileName.replace(/\.(md|mdx)$/i, ""),
          tags: [],
          excerpt: "",
          favorite,
        };
      }
    }),
  );
  return {
    notes,
    favoritePaths: [...favorites],
    folderAppearances: folderAppearancesForWorkspace(appState.folderAppearances, root),
  };
}
