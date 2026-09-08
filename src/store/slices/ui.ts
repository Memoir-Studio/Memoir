import { mergeLayout, type WorkspaceLayoutState } from "../../domain/layout";
import { DEFAULT_SETTINGS, mergeSettings, type AppSettings, type SettingsSection, type ViewMode } from "../../domain/settings";
import type { AppStore, LibraryPanelMode, UiSlice } from "../types";

type UiSliceContext = {
  set: (partial: Partial<AppStore>) => void;
  get: () => AppStore;
  persistPreferences: () => void;
};

export function createUiSlice({ set, get, persistPreferences }: UiSliceContext) {
  return {
    setLibraryPanelMode(libraryPanelMode: LibraryPanelMode) {
      set({
        libraryPanelMode,
        mobilePanel: libraryPanelMode === "graph" ? "editor" : "library",
      });
    },
    setViewMode(viewMode: ViewMode) {
      set({ viewMode });
    },
    setMobilePanel(mobilePanel: UiSlice["mobilePanel"]) {
      set({ mobilePanel });
    },
    setSidebarCollapsed(isSidebarCollapsed: boolean) {
      set({ isSidebarCollapsed });
      persistPreferences();
    },
    setLayout(partial: Partial<WorkspaceLayoutState>) {
      const layout = mergeLayout({ ...get().layout, ...partial });
      const current = get().layout;
      if (
        layout.sidebarWidth === current.sidebarWidth &&
        layout.libraryWidth === current.libraryWidth &&
        layout.editorSplit === current.editorSplit
      ) {
        return;
      }
      set({ layout });
      persistPreferences();
    },
    setSettings(settings: AppSettings) {
      set({ settings: mergeSettings(settings) });
      persistPreferences();
    },
    resetSettings() {
      set({ settings: DEFAULT_SETTINGS });
      persistPreferences();
    },
    openSettings(settingsSection: SettingsSection = "appearance") {
      set({ settingsOpen: true, settingsSection });
    },
    closeSettings() {
      set({ settingsOpen: false });
    },
    setSettingsSection(settingsSection: SettingsSection) {
      set({ settingsSection });
    },
    clearError() {
      set({ error: "" });
    },
  };
}
