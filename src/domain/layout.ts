export const COLLAPSED_SIDEBAR_WIDTH = 52;
export const DEFAULT_SIDEBAR_WIDTH = 164;
export const MIN_SIDEBAR_WIDTH = 148;
export const MAX_SIDEBAR_WIDTH = 360;
export const DEFAULT_LIBRARY_WIDTH = 280;
export const MIN_LIBRARY_WIDTH = 200;
export const MAX_LIBRARY_WIDTH = 520;
export const MIN_EDITOR_WIDTH = 280;
export const DEFAULT_EDITOR_SPLIT = 0.5;
export const MIN_EDITOR_SPLIT = 0.28;
export const MAX_EDITOR_SPLIT = 0.72;

export type WorkspaceLayoutState = {
  sidebarWidth: number;
  libraryWidth: number;
  editorSplit: number;
};

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayoutState = {
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
  libraryWidth: DEFAULT_LIBRARY_WIDTH,
  editorSplit: DEFAULT_EDITOR_SPLIT,
};

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(Math.min(max, Math.max(min, numeric)));
}

export function clampSidebarWidth(value: unknown) {
  return clampInteger(value, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH);
}

export function clampLibraryWidth(value: unknown) {
  return clampInteger(value, MIN_LIBRARY_WIDTH, MAX_LIBRARY_WIDTH, DEFAULT_LIBRARY_WIDTH);
}

export function clampEditorSplit(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_EDITOR_SPLIT;
  const stepped = Math.round(numeric * 1000) / 1000;
  return Math.min(MAX_EDITOR_SPLIT, Math.max(MIN_EDITOR_SPLIT, stepped));
}

export function mergeLayout(layout?: Partial<WorkspaceLayoutState> | null): WorkspaceLayoutState {
  return {
    sidebarWidth: clampSidebarWidth(layout?.sidebarWidth),
    libraryWidth: clampLibraryWidth(layout?.libraryWidth),
    editorSplit: clampEditorSplit(layout?.editorSplit),
  };
}

export function fitLayoutColumns({
  sidebarWidth,
  libraryWidth,
  collapsed,
  containerWidth,
}: {
  sidebarWidth: number;
  libraryWidth: number;
  collapsed: boolean;
  containerWidth: number;
}): { sidebar: number; library: number } {
  let sidebar = collapsed ? COLLAPSED_SIDEBAR_WIDTH : clampSidebarWidth(sidebarWidth);
  let library = clampLibraryWidth(libraryWidth);
  if (containerWidth <= 0) return { sidebar, library };

  const libraryBudget = containerWidth - sidebar - MIN_EDITOR_WIDTH;
  if (library > libraryBudget) {
    library = Math.max(libraryBudget, Math.min(MIN_LIBRARY_WIDTH, libraryBudget));
  }
  library = Math.max(0, library);

  if (!collapsed) {
    const sidebarBudget = containerWidth - library - MIN_EDITOR_WIDTH;
    if (sidebar > sidebarBudget) {
      sidebar = Math.max(sidebarBudget, Math.min(MIN_SIDEBAR_WIDTH, sidebarBudget));
    }
    sidebar = Math.max(COLLAPSED_SIDEBAR_WIDTH, sidebar);
  }

  return { sidebar, library };
}
