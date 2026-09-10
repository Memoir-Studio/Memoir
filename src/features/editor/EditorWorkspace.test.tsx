import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { useAppStore } from "../../store/app-store";
import { exportNotePdf } from "../export/export-note-pdf";
import { EditorWorkspace } from "./EditorWorkspace";

vi.mock("../export/export-note-pdf", () => ({
  exportNotePdf: vi.fn(),
}));

afterEach(() => {
  cleanup();
  useAppStore.setState({
    workspaceRoot: null,
    notes: [],
    activePath: null,
    loadedContentPath: null,
    content: "",
    savedContent: "",
    isLoading: false,
    settings: DEFAULT_SETTINGS,
    settingsOpen: false,
    settingsSection: "appearance",
    error: "",
    viewMode: "split",
  });
});

describe("EditorWorkspace PDF export", () => {
  it("exports the open note from the header button", async () => {
    useAppStore.setState({
      workspaceRoot: "/workspace",
      notes: [
        {
          relativePath: "alpha.md",
          fileName: "alpha.md",
          extension: "md",
          modifiedMs: 1,
          size: 10,
          title: "Alpha Guide",
          tags: [],
          excerpt: "",
          favorite: false,
        },
      ],
      activePath: "alpha.md",
      loadedContentPath: "alpha.md",
      content: "# Alpha Guide",
      savedContent: "# Alpha Guide",
    });
    const user = userEvent.setup();
    const view = render(
      <EditorWorkspace isDark={false} onDelete={() => undefined} onRename={() => undefined} />,
    );

    await user.click(view.getByRole("button", { name: "导出 PDF" }));
    expect(exportNotePdf).toHaveBeenCalledWith("alpha.md");
  });

  it("offers expanded Markdown formatting and applies a selected heading level", async () => {
    useAppStore.setState({
      workspaceRoot: "/workspace",
      notes: [
        {
          relativePath: "alpha.md",
          fileName: "alpha.md",
          extension: "md",
          modifiedMs: 1,
          size: 10,
          title: "Alpha Guide",
          tags: [],
          excerpt: "",
          favorite: false,
        },
      ],
      activePath: "alpha.md",
      loadedContentPath: "alpha.md",
      content: "# Alpha Guide",
      savedContent: "# Alpha Guide",
      viewMode: "split",
    });
    const user = userEvent.setup();
    const view = render(
      <EditorWorkspace isDark={false} onDelete={() => undefined} onRename={() => undefined} />,
    );

    await waitFor(() => expect(view.container.querySelector("[data-editor-pane]")).toBeTruthy());
    expect(view.getByRole("button", { name: "任务列表" })).toBeEnabled();
    expect(view.getByRole("button", { name: "代码块" })).toBeEnabled();
    expect(view.getByRole("button", { name: "表格" })).toBeEnabled();

    await user.click(view.getByRole("button", { name: "标题样式" }));
    await user.click(view.getByRole("menuitem", { name: "2 级标题" }));
    await waitFor(() => expect(useAppStore.getState().content).toBe("## Alpha Guide"));

    await user.click(view.getByRole("button", { name: "更多格式" }));
    expect(view.getByRole("menuitem", { name: "公式块" })).toBeInTheDocument();
    expect(view.getByRole("menuitem", { name: "提示块" })).toBeInTheDocument();
    expect(view.getByRole("menuitem", { name: "分隔线" })).toBeInTheDocument();
  });

  it("disables formatting controls when only the preview is visible", async () => {
    useAppStore.setState({
      workspaceRoot: "/workspace",
      notes: [
        {
          relativePath: "alpha.md",
          fileName: "alpha.md",
          extension: "md",
          modifiedMs: 1,
          size: 10,
          title: "Alpha Guide",
          tags: [],
          excerpt: "",
          favorite: false,
        },
      ],
      activePath: "alpha.md",
      loadedContentPath: "alpha.md",
      content: "# Alpha Guide",
      savedContent: "# Alpha Guide",
      viewMode: "preview",
    });
    const view = render(
      <EditorWorkspace isDark={false} onDelete={() => undefined} onRename={() => undefined} />,
    );

    await view.findByRole("region", { name: "实时预览" });
    expect(view.getByRole("button", { name: "粗体" })).toBeDisabled();
    expect(view.getByRole("button", { name: "标题样式" })).toBeDisabled();
    expect(view.getByRole("button", { name: "更多格式" })).toBeDisabled();
  });

  it("keeps the previous document visible while the next note is loading", async () => {
    useAppStore.setState({
      workspaceRoot: "/workspace",
      notes: [
        {
          relativePath: "alpha.md",
          fileName: "alpha.md",
          extension: "md",
          modifiedMs: 1,
          size: 10,
          title: "Alpha",
          tags: [],
          excerpt: "",
          favorite: false,
        },
        {
          relativePath: "beta.md",
          fileName: "beta.md",
          extension: "md",
          modifiedMs: 2,
          size: 10,
          title: "Beta",
          tags: [],
          excerpt: "",
          favorite: false,
        },
      ],
      activePath: "beta.md",
      loadedContentPath: "alpha.md",
      content: "# Alpha",
      savedContent: "# Alpha",
      isLoading: true,
      viewMode: "split",
    });
    const view = render(
      <EditorWorkspace isDark={false} onDelete={() => undefined} onRename={() => undefined} />,
    );

    await waitFor(() => expect(view.container.querySelector("[data-editor-pane]")).toBeTruthy());
    const content = view.container.querySelector("[data-switching-note]");
    expect(content?.querySelector('[role="status"]')).toHaveTextContent("正在打开笔记…");
    expect(content).toHaveAttribute("aria-busy", "true");
    expect(content?.querySelector("[data-editor-pane]")?.closest("[inert]")).toBeTruthy();
    expect(view.getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("invokes header delete and rename without passing the click event", async () => {
    useAppStore.setState({
      workspaceRoot: "/workspace",
      notes: [
        {
          relativePath: "alpha.md",
          fileName: "alpha.md",
          extension: "md",
          modifiedMs: 1,
          size: 10,
          title: "Alpha Guide",
          tags: [],
          excerpt: "",
          favorite: false,
        },
      ],
      activePath: "alpha.md",
      loadedContentPath: "alpha.md",
      content: "# Alpha Guide",
      savedContent: "# Alpha Guide",
    });
    const onDelete = vi.fn();
    const onRename = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <EditorWorkspace isDark={false} onDelete={onDelete} onRename={onRename} />,
    );

    await user.click(view.getByRole("button", { name: "删除" }));
    await user.click(view.getByRole("button", { name: "重命名" }));
    expect(onDelete).toHaveBeenCalledWith();
    expect(onRename).toHaveBeenCalledWith();
  });

});
