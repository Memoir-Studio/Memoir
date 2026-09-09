import { describe, expect, it, vi } from "vitest";
import { createLibrarySlice } from "./library";
import { createUiSlice } from "./ui";

describe("store slices", () => {
  it("keeps library actions focused on state and query scheduling", () => {
    const set = vi.fn();
    const scheduleQuery = vi.fn();
    const runQueryNow = vi.fn();
    const slice = createLibrarySlice({ set, scheduleQuery, runQueryNow });

    slice.setQuery(" roadmap ");
    slice.setNavFilter("favorites");
    slice.setScopedFilter({ type: "tag", value: "work" });
    slice.setLibraryPanelMode("graph");

    expect(set).toHaveBeenNthCalledWith(1, { query: " roadmap " });
    expect(scheduleQuery).toHaveBeenCalledOnce();
    expect(runQueryNow).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenLastCalledWith({
      libraryPanelMode: "graph",
      mobilePanel: "editor",
    });
  });

  it("keeps UI persistence behind an injected callback", () => {
    const set = vi.fn();
    const get = vi.fn(() => ({
      layout: { sidebarWidth: 200, libraryWidth: 280, editorSplit: 0.5 },
    }));
    const persistPreferences = vi.fn();
    const slice = createUiSlice({ set, get: get as never, persistPreferences });

    slice.setSidebarCollapsed(true);
    slice.openSettings("editor");
    slice.clearError();

    expect(set).toHaveBeenNthCalledWith(1, { isSidebarCollapsed: true });
    expect(persistPreferences).toHaveBeenCalledOnce();
    expect(set).toHaveBeenLastCalledWith({ error: "" });
  });

  it("updates interface scale with clamping and persistence", () => {
    const set = vi.fn();
    const get = vi.fn(() => ({
      settings: { appearance: { uiScale: 1 } },
    }));
    const persistPreferences = vi.fn();
    const slice = createUiSlice({ set, get: get as never, persistPreferences });

    slice.setUiScale(1.05);
    expect(set).toHaveBeenCalledWith({
      settings: { appearance: { uiScale: 1.05 } },
    });
    expect(persistPreferences).toHaveBeenCalledOnce();
  });
});
