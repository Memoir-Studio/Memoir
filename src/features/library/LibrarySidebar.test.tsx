import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyLibraryStats } from "../../domain/notes";
import { useAppStore } from "../../store/app-store";
import { LibrarySidebar } from "./LibrarySidebar";

afterEach(() => {
  cleanup();
  useAppStore.setState({
    workspaceRoot: null,
    notes: [],
    libraryStats: {
      total: 0,
      recent: 0,
      favorites: 0,
      folders: [],
      tags: [],
      truncated: false,
    },
    folderAppearances: {},
    navFilter: "all",
    scopedFilter: null,
    isSidebarCollapsed: false,
    attachments: [],
    libraryPanelMode: "notes",
  });
});

describe("LibrarySidebar graph", () => {
  it("opens the graph panel", async () => {
    const user = userEvent.setup();
    useAppStore.setState({
      workspaceRoot: "/notes",
      libraryStats: { ...emptyLibraryStats(), total: 1 },
    });
    const view = render(
      <LibrarySidebar isDark={false} onCreateFolder={() => undefined} onCreateTag={() => undefined} />,
    );
    expect(view.getByRole("button", { name: "图谱" })).toBeInTheDocument();
    await user.click(view.getByRole("button", { name: "图谱" }));
    expect(useAppStore.getState().libraryPanelMode).toBe("graph");
  });

  it("keeps an expand control in the collapsed sidebar rail", async () => {
    useAppStore.setState({
      workspaceRoot: "/notes",
      isSidebarCollapsed: true,
    });
    const user = userEvent.setup();
    const view = render(
      <LibrarySidebar isDark={false} onCreateFolder={() => undefined} onCreateTag={() => undefined} />,
    );

    const expand = view.getByRole("button", { name: "展开导航" });
    expect(expand).toBeVisible();
    await user.click(expand);
    expect(useAppStore.getState().isSidebarCollapsed).toBe(false);
    expect(view.getByRole("button", { name: "收起导航" })).toBeVisible();
  });
});

describe("LibrarySidebar folders", () => {
  it("renders a custom folder emoji and opens the appearance dialog", async () => {
    useAppStore.setState({
      workspaceRoot: "/notes",
      notes: [
        {
          relativePath: "日记/today.md",
          fileName: "today.md",
          extension: "md",
          modifiedMs: 1,
          size: 10,
          title: "今日",
          tags: [],
          excerpt: "",
          favorite: false,
        },
      ],
      libraryStats: {
        ...emptyLibraryStats(),
        total: 1,
        folders: [{ folder: "日记", count: 1 }],
      },
      folderAppearances: {
        日记: { emoji: "📔", color: "coral" },
      },
    });
    const user = userEvent.setup();
    const view = render(
      <LibrarySidebar isDark={false} onCreateFolder={() => undefined} onCreateTag={() => undefined} />,
    );

    expect(view.getByText("📔")).toBeInTheDocument();
    expect(view.getByText("日记")).toBeInTheDocument();

    await user.click(view.getByRole("button", { name: "自定义“日记”的外观" }));
    expect(view.getByRole("dialog", { name: "自定义文件夹" })).toBeInTheDocument();
    expect(view.getByText("为“日记”选择图标和颜色")).toBeInTheDocument();
  });

  it("opens a folder context menu", async () => {
    useAppStore.setState({
      workspaceRoot: "/notes",
      notes: [
        {
          relativePath: "思考/note.md",
          fileName: "note.md",
          extension: "md",
          modifiedMs: 1,
          size: 10,
          title: "思考",
          tags: [],
          excerpt: "",
          favorite: false,
        },
      ],
      libraryStats: {
        ...emptyLibraryStats(),
        total: 1,
        folders: [{ folder: "思考", count: 1 }],
      },
      folderAppearances: {},
    });
    const onCreateFolder = vi.fn();
    const onCreateNote = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <LibrarySidebar
        isDark={false}
        onCreateFolder={onCreateFolder}
        onCreateNote={onCreateNote}
        onCreateTag={() => undefined}
      />,
    );

    fireEvent.contextMenu(view.getByRole("button", { name: "思考" }));
    expect(view.getByRole("menu", { name: "思考 的操作" })).toBeInTheDocument();
    expect(view.getByRole("menuitem", { name: "自定义外观" })).toBeInTheDocument();
    await user.click(view.getByRole("menuitem", { name: "新建笔记" }));
    expect(onCreateNote).toHaveBeenCalledWith("思考");

    fireEvent.contextMenu(view.getByRole("button", { name: "思考" }));
    await user.click(view.getByRole("menuitem", { name: "新建文件夹" }));
    expect(onCreateFolder).toHaveBeenCalledWith("思考");
  });

  it("uses the folders section plus button to create a root folder", async () => {
    const onCreateFolder = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <LibrarySidebar isDark={false} onCreateFolder={onCreateFolder} onCreateTag={() => undefined} />,
    );

    await user.click(view.getByRole("button", { name: "新建文件夹" }));
    expect(onCreateFolder).toHaveBeenCalledWith("");
  });

  it("opens cloud sync from the drawer", async () => {
    useAppStore.setState({
      workspaceRoot: "/notes",
      libraryPanelMode: "notes",
      libraryStats: { ...emptyLibraryStats(), total: 1 },
    });
    const user = userEvent.setup();
    const view = render(
      <LibrarySidebar isDark={false} onCreateFolder={() => undefined} onCreateTag={() => undefined} />,
    );

    await user.click(view.getByRole("button", { name: "云同步" }));
    expect(useAppStore.getState().libraryPanelMode).toBe("sync");
    expect(view.getByRole("button", { name: "云同步" })).toHaveAttribute("aria-current", "page");
  });

  it("opens AI editing from the drawer", async () => {
    useAppStore.setState({
      workspaceRoot: "/notes",
      libraryPanelMode: "notes",
    });
    const user = userEvent.setup();
    const view = render(
      <LibrarySidebar isDark={false} onCreateFolder={() => undefined} onCreateTag={() => undefined} />,
    );

    await user.click(view.getByRole("button", { name: "AI 助手" }));
    expect(useAppStore.getState().libraryPanelMode).toBe("ai");
    expect(view.getByRole("button", { name: "AI 助手" })).toHaveAttribute("aria-current", "page");
  });

  it("opens the workspace index panel from the drawer", async () => {
    useAppStore.setState({
      workspaceRoot: "/notes",
      notes: [
        {
          relativePath: "one.md",
          fileName: "one.md",
          extension: "md",
          modifiedMs: 1,
          size: 10,
          title: "One",
          tags: [],
          excerpt: "",
          favorite: false,
        },
      ],
      libraryPanelMode: "notes",
      libraryStats: { ...emptyLibraryStats(), total: 1 },
    });
    const user = userEvent.setup();
    const view = render(
      <LibrarySidebar isDark={false} onCreateFolder={() => undefined} onCreateTag={() => undefined} />,
    );

    await user.click(view.getByRole("button", { name: "索引库" }));
    expect(useAppStore.getState().libraryPanelMode).toBe("index");
    expect(view.getByRole("button", { name: "索引库" })).toHaveAttribute("aria-current", "page");
  });

  it("renders folder and tag counts from libraryStats, not a full notes dump", () => {
    useAppStore.setState({
      workspaceRoot: "/notes",
      notes: [],
      libraryStats: {
        ...emptyLibraryStats(),
        total: 4,
        recent: 2,
        favorites: 1,
        folders: [{ folder: "日记", count: 3 }],
        tags: [{ tag: "diary", tagNorm: "diary", count: 2 }],
      },
    });
    const view = render(
      <LibrarySidebar isDark={false} onCreateFolder={() => undefined} onCreateTag={() => undefined} />,
    );
    expect(view.getByRole("button", { name: "日记" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "diary 2" })).toBeInTheDocument();
    expect(view.getByText("3")).toBeInTheDocument();
    expect(view.getByRole("button", { name: "最近编辑 2" })).toBeInTheDocument();
    expect(view.getByText("日记")).toHaveAttribute("data-sidebar-nav-label");
    expect(view.getByText("最近编辑")).toHaveAttribute("data-sidebar-nav-label");
  });

  it("nests child folders beside the workspace root, not inside it", async () => {
    useAppStore.setState({
      workspaceRoot: "/notes",
      libraryStats: {
        ...emptyLibraryStats(),
        total: 4,
        folders: [
          { folder: "", count: 1 },
          { folder: "lessons/week1", count: 3 },
        ],
      },
    });
    const user = userEvent.setup();
    const view = render(
      <LibrarySidebar isDark={false} onCreateFolder={() => undefined} onCreateTag={() => undefined} />,
    );

    expect(view.getByRole("button", { name: "根目录" })).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "折叠“根目录”" })).not.toBeInTheDocument();
    const rootRow = view.getByRole("button", { name: "根目录" }).closest("[data-sidebar-folder-item]");
    expect(rootRow?.querySelector("[data-sidebar-folder-toggle]")).toBeNull();
    expect(rootRow?.querySelector("[data-sidebar-folder-toggle-spacer]")).toBeNull();
    expect(view.getByRole("button", { name: "lessons" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "折叠“lessons”" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "week1" })).toBeInTheDocument();
    const leafRow = view.getByRole("button", { name: "week1" }).closest("[data-sidebar-folder-item]");
    expect(leafRow?.querySelector("[data-sidebar-folder-toggle]")).toBeNull();
    expect(leafRow?.querySelector("[data-sidebar-folder-toggle-spacer]")).toBeInTheDocument();
    expect(view.getAllByText("3")).toHaveLength(2);

    await user.click(view.getByRole("button", { name: "折叠“lessons”" }));
    expect(view.queryByRole("button", { name: "week1" })).not.toBeInTheDocument();

    await user.click(view.getByRole("button", { name: "展开“lessons”" }));
    await user.click(view.getByRole("button", { name: "lessons" }));
    expect(useAppStore.getState().scopedFilter).toEqual({ type: "folder", value: "lessons" });
  });
});
