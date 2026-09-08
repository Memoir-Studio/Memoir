import type { FolderAppearance } from "../../domain/folders";
type WorkspaceSliceContext = {
  openWorkspace: (root?: string) => Promise<void>;
  initialize: () => Promise<void>;
  refreshWorkspace: (preferredPath?: string | null) => Promise<void>;
  createNote: (input: {
    title: string;
    extension: "md" | "mdx";
    folder?: string;
    tags?: string[];
  }) => Promise<void>;
  rebuildIndex: () => Promise<void>;
  renameNote: (relativePath: string, newRelativePath: string) => Promise<void>;
  renameActiveNote: (newRelativePath: string) => Promise<void>;
  deleteNote: (relativePath: string) => Promise<void>;
  deleteActiveNote: () => Promise<void>;
  setFolderAppearance: (folder: string, appearance: FolderAppearance | null) => Promise<void>;
  toggleFavorite: (relativePath?: string) => Promise<void>;
};

export function createWorkspaceSlice({
  openWorkspace,
  initialize,
  refreshWorkspace,
  createNote,
  rebuildIndex,
  renameNote,
  renameActiveNote,
  deleteNote,
  deleteActiveNote,
  setFolderAppearance,
  toggleFavorite,
}: WorkspaceSliceContext) {
  return {
    openWorkspace,
    initialize,
    refreshWorkspace,
    createNote,
    rebuildIndex,
    renameNote,
    renameActiveNote,
    deleteNote,
    deleteActiveNote,
    setFolderAppearance,
    toggleFavorite,
  };
}
