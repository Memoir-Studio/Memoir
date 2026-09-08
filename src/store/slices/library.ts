import type { AppStore, LibraryPanelMode } from "../types";
import type { NavFilter, ScopedFilter } from "../../domain/notes";

type LibrarySliceContext = {
  set: (partial: Partial<AppStore>) => void;
  scheduleQuery: () => void;
  runQueryNow: () => void;
};

export function createLibrarySlice({ set, scheduleQuery, runQueryNow }: LibrarySliceContext) {
  return {
    setQuery(query: string) {
      set({ query });
      scheduleQuery();
    },
    setNavFilter(navFilter: NavFilter) {
      set({ navFilter, scopedFilter: null, mobilePanel: "library", libraryPanelMode: "notes" });
      runQueryNow();
    },
    setScopedFilter(scopedFilter: ScopedFilter) {
      set({ scopedFilter, navFilter: "all", mobilePanel: "library", libraryPanelMode: "notes" });
      runQueryNow();
    },
    setLibraryPanelMode(libraryPanelMode: LibraryPanelMode) {
      set({
        libraryPanelMode,
        mobilePanel: libraryPanelMode === "graph" ? "editor" : "library",
      });
    },
  };
}
