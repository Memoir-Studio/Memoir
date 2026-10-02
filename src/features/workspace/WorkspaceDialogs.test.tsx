import { cleanup, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/app-store";
import { useWorkspaceDialogs, WorkspaceDialogsProvider } from "./WorkspaceDialogs";

afterEach(() => {
  cleanup();
  useAppStore.setState({
    workspaceRoot: "/workspace",
    notes: [],
    folderAppearances: {},
    libraryStats: { ...useAppStore.getState().libraryStats, folders: [] },
    activePath: null,
    loadedContentPath: null,
    content: "",
    savedContent: "",
    scopedFilter: null,
    error: "",
    isLoading: false,
  });
});

function Harness() {
  const { openCreate, openRenameFolder, openDeleteFolder } = useWorkspaceDialogs();
  return (
    <>
      <button onClick={() => openRenameFolder("工作/项目")}>重命名目录</button>
      <button onClick={() => openDeleteFolder("工作/项目")}>删除目录</button>
      <button onClick={() => openCreate("mdx", "", "日记")} type="button">
        打开带标签新建
      </button>
    </>
  );
}

describe("WorkspaceDialogs", () => {
  it("moves a note to nested, empty and root folders and keeps failures open for retry", async () => {
    const moveNote = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      moveNote,
      activePath: "工作/alpha.mdx",
      error: "",
      isLoading: false,
      libraryStats: {
        ...useAppStore.getState().libraryStats,
        folders: [{ folder: "工作", count: 1 }, { folder: "归档/空目录", count: 0 }],
      },
    });
    function MoveHarness() {
      const { openMove } = useWorkspaceDialogs();
      return <button onClick={() => openMove()}>打开移动</button>;
    }
    const user = userEvent.setup();
    const view = render(<WorkspaceDialogsProvider><MoveHarness /></WorkspaceDialogsProvider>);
    await user.click(view.getByRole("button", { name: "打开移动" }));
    expect(view.getByRole("button", { name: "移动" })).toBeDisabled();
    await user.click(view.getByRole("combobox", { name: "目标目录" }));
    expect(view.getByRole("option", { name: "归档" })).toBeInTheDocument();
    await user.click(view.getByRole("option", { name: "归档/空目录" }));
    moveNote.mockImplementationOnce(async () => { useAppStore.setState({ error: "移动失败：目标文件已存在" }); });
    await user.click(view.getByRole("button", { name: "移动" }));
    expect(moveNote).toHaveBeenLastCalledWith("工作/alpha.mdx", "归档/空目录");
    expect(view.getByRole("dialog", { name: "移动笔记" })).toBeInTheDocument();
    expect(view.getByRole("alert")).toHaveTextContent("目标文件已存在");
    await user.click(view.getByRole("combobox", { name: "目标目录" }));
    await user.click(view.getByRole("option", { name: "根目录" }));
    moveNote.mockImplementationOnce(async () => { useAppStore.setState({ error: "" }); });
    await user.click(view.getByRole("button", { name: "移动" }));
    expect(moveNote).toHaveBeenLastCalledWith("工作/alpha.mdx", "");
    await waitFor(() => expect(view.queryByRole("dialog", { name: "移动笔记" })).not.toBeInTheDocument());
    await user.click(view.getByRole("button", { name: "打开移动" }));
    await user.click(view.getByRole("button", { name: "取消" }));
    expect(moveNote).toHaveBeenCalledTimes(2);
  });

  it("renames only the folder basename and confirms deletion", async () => {
    const renameFolder = vi.fn().mockResolvedValue(undefined);
    const deleteFolder = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ renameFolder, deleteFolder, error: "", isLoading: false });
    const user = userEvent.setup();
    const view = render(<WorkspaceDialogsProvider><Harness /></WorkspaceDialogsProvider>);
    await user.click(view.getByRole("button", { name: "重命名目录" }));
    const input = view.getByLabelText("文件夹名称");
    expect(input).toHaveValue("项目");
    await user.clear(input);
    expect(view.getByRole("button", { name: "重命名" })).toBeDisabled();
    await user.type(input, "资料{Enter}");
    expect(renameFolder).toHaveBeenCalledWith("工作/项目", "工作/资料");
    await user.click(view.getByRole("button", { name: "删除目录" }));
    expect(deleteFolder).not.toHaveBeenCalled();
    await user.click(within(view.getByRole("dialog", { name: "删除文件夹" })).getByRole("button", { name: "取消" }));
    expect(deleteFolder).not.toHaveBeenCalled();
    await user.click(view.getByRole("button", { name: "删除目录" }));
    await user.click(view.getByRole("button", { name: "移入回收站" }));
    expect(deleteFolder).toHaveBeenCalledWith("工作/项目");
  });

  it("keeps a prefilled tag and flushes leftover typed tags on submit", async () => {
    const createNote = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ createNote });
    const user = userEvent.setup();
    const view = render(
      <WorkspaceDialogsProvider>
        <Harness />
      </WorkspaceDialogsProvider>,
    );

    await user.click(view.getByRole("button", { name: "打开带标签新建" }));
    expect(view.getByText("日记")).toBeInTheDocument();
    await user.type(view.getByRole("combobox", { name: "标签（可选）" }), "rust");
    await user.type(view.getByLabelText("标题"), "行程{Enter}");

    expect(createNote).toHaveBeenCalledWith({
      title: "行程",
      extension: "mdx",
      folder: undefined,
      tags: ["日记", "rust"],
    });
  });

  it("keeps the folder when renaming only the file name", async () => {
    const renameNote = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      activePath: "工作/alpha.md",
      renameNote,
    });
    function ClickHarness() {
      const { openRename } = useWorkspaceDialogs();
      return (
        <button onClick={() => openRename("工作/alpha.md")} type="button">
          打开目录重命名
        </button>
      );
    }
    const user = userEvent.setup();
    const view = render(
      <WorkspaceDialogsProvider>
        <ClickHarness />
      </WorkspaceDialogsProvider>,
    );

    await user.click(view.getByRole("button", { name: "打开目录重命名" }));
    const field = view.getByLabelText("文件名");
    expect(field).toHaveValue("alpha.md");
    await user.clear(field);
    await user.type(field, "gamma{Enter}");

    expect(renameNote).toHaveBeenCalledWith("工作/alpha.md", "工作/gamma.md");
  });
});
