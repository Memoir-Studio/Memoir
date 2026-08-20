import { describe, expect, it } from "vitest";
import {
  COLLAPSED_SIDEBAR_WIDTH,
  DEFAULT_EDITOR_SPLIT,
  DEFAULT_LIBRARY_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_LIBRARY_WIDTH,
  MIN_EDITOR_WIDTH,
  MIN_LIBRARY_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampEditorSplit,
  clampLibraryWidth,
  clampSidebarWidth,
  fitLayoutColumns,
  mergeLayout,
} from "./layout";

describe("workspace layout", () => {
  it("clamps widths and split ratio, falling back for junk", () => {
    expect(clampSidebarWidth(200)).toBe(200);
    expect(clampSidebarWidth(80)).toBe(MIN_SIDEBAR_WIDTH);
    expect(clampSidebarWidth(999)).toBe(360);
    expect(clampSidebarWidth("nope")).toBe(DEFAULT_SIDEBAR_WIDTH);
    expect(clampLibraryWidth(240)).toBe(240);
    expect(clampLibraryWidth(20)).toBe(MIN_LIBRARY_WIDTH);
    expect(clampLibraryWidth(800)).toBe(MAX_LIBRARY_WIDTH);
    expect(clampEditorSplit(0.4)).toBe(0.4);
    expect(clampEditorSplit(0.01)).toBe(0.28);
    expect(clampEditorSplit(2)).toBe(0.72);
    expect(clampEditorSplit(Number.NaN)).toBe(DEFAULT_EDITOR_SPLIT);
  });

  it("fills defaults when layout is missing", () => {
    expect(mergeLayout(null)).toEqual({
      sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      libraryWidth: DEFAULT_LIBRARY_WIDTH,
      editorSplit: DEFAULT_EDITOR_SPLIT,
    });
    expect(mergeLayout({ sidebarWidth: 200, libraryWidth: 40, editorSplit: 0.6 })).toEqual({
      sidebarWidth: 200,
      libraryWidth: MIN_LIBRARY_WIDTH,
      editorSplit: 0.6,
    });
  });

  it("keeps preferred columns when the window is wide enough", () => {
    expect(
      fitLayoutColumns({
        sidebarWidth: 200,
        libraryWidth: 300,
        collapsed: false,
        containerWidth: 1200,
      }),
    ).toEqual({ sidebar: 200, library: 300 });
  });

  it("shrinks the notes list before the sidebar when space is tight", () => {
    const fitted = fitLayoutColumns({
      sidebarWidth: 200,
      libraryWidth: 400,
      collapsed: false,
      containerWidth: 200 + MIN_LIBRARY_WIDTH + MIN_EDITOR_WIDTH,
    });
    expect(fitted.sidebar).toBe(200);
    expect(fitted.library).toBe(MIN_LIBRARY_WIDTH);
  });

  it("uses the collapsed rail width", () => {
    expect(
      fitLayoutColumns({
        sidebarWidth: 200,
        libraryWidth: 280,
        collapsed: true,
        containerWidth: 1200,
      }),
    ).toEqual({ sidebar: COLLAPSED_SIDEBAR_WIDTH, library: 280 });
  });
});
