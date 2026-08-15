import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "../../store/app-store";
import { LibrarySidebar } from "./LibrarySidebar";

afterEach(() => {
  cleanup();
  useAppStore.setState({
    workspaceRoot: null,
    notes: [],
    folderAppearances: {},
    navFilter: "all",
    scopedFilter: null,
    isSidebarCollapsed: false,
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

    await user.click(view.getByRole("button", { name: "自定义外观" }));
    expect(view.getByRole("dialog", { name: "自定义文件夹" })).toBeInTheDocument();
    expect(view.getByText("为“日记”选择图标和颜色")).toBeInTheDocument();
  });

  it("opens a folder context menu", () => {
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
      folderAppearances: {},
    });
    const view = render(
      <LibrarySidebar isDark={false} onCreateFolder={() => undefined} onCreateTag={() => undefined} />,
    );

    fireEvent.contextMenu(view.getByRole("button", { name: "思考" }));
    expect(view.getByRole("menu", { name: "思考 的操作" })).toBeInTheDocument();
    expect(view.getByRole("menuitem", { name: "自定义外观" })).toBeInTheDocument();
  });
});
