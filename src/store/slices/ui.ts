import { mergeLayout, type WorkspaceLayoutState } from "../../domain/layout";
import {
  clampUiScale,
  DEFAULT_SETTINGS,
  mergeSettings,
  type AppSettings,
  type SettingsSection,
  type ViewMode,
} from "../../domain/settings";
import type { AppStore, LibraryPanelMode, UiSlice } from "../types";

type UiSliceContext = {
  set: (partial: Partial<AppStore>) => void;
  get: () => AppStore;
  persistPreferences: () => void;
  onSettingsChanged?: (previous: AppSettings, next: AppSettings) => void;
};

export function createUiSlice({ set, get, persistPreferences, onSettingsChanged }: UiSliceContext) {
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
    setUiScale(scale: number) {
      const settings = get().settings;
      const uiScale = clampUiScale(scale);
      if (uiScale === settings.appearance.uiScale) return;
      set({
        settings: {
          ...settings,
          appearance: { ...settings.appearance, uiScale },
        },
      });
      persistPreferences();
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
      const previous = get().settings;
      const next = mergeSettings(settings);
      set({ settings: next });
      persistPreferences();
      onSettingsChanged?.(previous, next);
    },
    resetSettings() {
      const previous = get().settings;
      set({ settings: DEFAULT_SETTINGS });
      persistPreferences();
      onSettingsChanged?.(previous, DEFAULT_SETTINGS);
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
