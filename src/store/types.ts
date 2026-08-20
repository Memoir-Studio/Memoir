import type { AttachmentFile, SaveAttachmentInput } from "../domain/attachments";
import type { FolderAppearance } from "../domain/folders";
import type {
  LibraryStats,
  NoteExtension,
  NoteMeta,
  NavFilter,
  ScopedFilter,
} from "../domain/notes";
import type { AppSettings, ViewMode } from "../domain/settings";
import type {
  CloudSyncProbe,
  CloudSyncProfile,
  CloudSyncProfileInput,
  CloudSyncRunResult,
} from "../domain/cloud-sync";
import type { WorkspaceLayoutState } from "../domain/layout";
import type { SettingsSection } from "../features/settings/types";

export type WorkspaceSlice = {
  workspaceRoot: string | null;
  recentWorkspaces: string[];
  notes: NoteMeta[];
  libraryStats: LibraryStats;
  favoritePaths: string[];
  attachments: AttachmentFile[];
  isLoading: boolean;
  folderAppearances: Record<string, FolderAppearance>;
};

export type DocumentSlice = {
  activePath: string | null;
  loadedContentPath: string | null;
  content: string;
  savedContent: string;
  isSaving: boolean;
};

export type LibraryPanelMode = "notes" | "outline" | "attachments" | "index" | "sync";

export type LibrarySlice = {
  query: string;
  navFilter: NavFilter;
  scopedFilter: ScopedFilter;
  libraryPanelMode: LibraryPanelMode;
};

export type SettingsSlice = {
  settings: AppSettings;
};

export type UiSlice = {
  initialized: boolean;
  status: string;
  error: string;
  viewMode: ViewMode;
  isSidebarCollapsed: boolean;
  layout: WorkspaceLayoutState;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  cloudSyncProfile: CloudSyncProfile;
  mobilePanel: "editor" | "library" | "navigation";
};

export type AppActions = {
  initialize(): Promise<void>;
  openWorkspace(root?: string): Promise<void>;
  refreshWorkspace(preferredPath?: string | null): Promise<void>;
  selectNote(relativePath: string): Promise<void>;
  setContent(content: string): void;
  saveActiveNote(): Promise<void>;
  createNote(input: {
    title: string;
    extension: NoteExtension;
    folder?: string;
    tags?: string[];
  }): Promise<void>;
  renameNote(relativePath: string, newRelativePath: string): Promise<void>;
  renameActiveNote(newRelativePath: string): Promise<void>;
  deleteNote(relativePath: string): Promise<void>;
  deleteActiveNote(): Promise<void>;
  toggleFavorite(relativePath?: string): Promise<void>;
  setFolderAppearance(folder: string, appearance: FolderAppearance | null): Promise<void>;
  refreshAttachments(): Promise<void>;
  saveAttachments(inputs: SaveAttachmentInput[]): Promise<AttachmentFile[]>;
  savePastedImages(files: File[]): Promise<string>;
  importDroppedImages(sourcePaths: string[]): Promise<string>;
  importAttachments(): Promise<AttachmentFile[]>;
  deleteAttachment(relativePath: string): Promise<void>;
  rebuildIndex(): Promise<void>;
  setQuery(query: string): void;
  setNavFilter(navFilter: NavFilter): void;
  setScopedFilter(scopedFilter: ScopedFilter): void;
  setLibraryPanelMode(mode: LibrarySlice["libraryPanelMode"]): void;
  setViewMode(mode: ViewMode): void;
  setSidebarCollapsed(collapsed: boolean): void;
  setLayout(layout: Partial<WorkspaceLayoutState>): void;
  setSettings(settings: AppSettings): void;
  resetSettings(): void;
  openSettings(section?: SettingsSection): void;
  closeSettings(): void;
  setSettingsSection(section: SettingsSection): void;
  saveCloudSyncProfile(profile: CloudSyncProfileInput): Promise<void>;
  testCloudSync(profile: CloudSyncProfileInput): Promise<CloudSyncProbe>;
  runCloudSync(profile?: CloudSyncProfileInput): Promise<CloudSyncRunResult | null>;
  setMobilePanel(panel: UiSlice["mobilePanel"]): void;
  clearError(): void;
};

export type AppStore = WorkspaceSlice &
  DocumentSlice &
  LibrarySlice &
  SettingsSlice &
  UiSlice &
  AppActions;
