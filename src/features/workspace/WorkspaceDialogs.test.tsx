import { cleanup, render, waitFor } from "@testing-library/react";
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
    activePath: null,
    loadedContentPath: null,
    content: "",
    savedContent: "",
  });
});

function Harness() {
  const { openCreate, openDelete, openRename } = useWorkspaceDialogs();
  return (
    <>
      <button onClick={() => openCreate()} type="button">
        打开新建
      </button>
      <button onClick={() => openCreate("mdx", "", "日记")} type="button">
        打开带标签新建
      </button>
      <button onClick={() => openRename("alpha.md")} type="button">
        打开重命名
      </button>
      <button onClick={() => openDelete("alpha.md")} type="button">
        打开删除
      </button>
    </>
  );
}

describe("WorkspaceDialogs", () => {
  it("creates a note when Enter is pressed in the title field", async () => {
    const createNote = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ createNote });
    const user = userEvent.setup();
    const view = render(
      <WorkspaceDialogsProvider>
        <Harness />
      </WorkspaceDialogsProvider>,
    );

    await user.click(view.getByRole("button", { name: "打开新建" }));
    await user.type(view.getByLabelText("标题"), "天气好{Enter}");

    expect(createNote).toHaveBeenCalledWith({
      title: "天气好",
      extension: "mdx",
      folder: undefined,
      tags: undefined,
    });
    await waitFor(() => {
      expect(view.queryByRole("dialog", { name: "新建笔记" })).not.toBeInTheDocument();
    });
  });

  it("lets the user pick an existing folder from the combobox", async () => {
    const createNote = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      createNote,
      notes: [
        {
          relativePath: "工作/alpha.md",
          fileName: "alpha.md",
          extension: "md",
          modifiedMs: 1,
          size: 1,
          title: "Alpha",
          tags: [],
          excerpt: "",
          favorite: false,
        },
        {
          relativePath: "日记/2024/beta.md",
          fileName: "beta.md",
          extension: "md",
          modifiedMs: 1,
          size: 1,
          title: "Beta",
          tags: [],
          excerpt: "",
          favorite: false,
        },
      ],
      folderAppearances: {
        日记: { emoji: "📔" },
      },
    });
    const user = userEvent.setup();
    const view = render(
      <WorkspaceDialogsProvider>
        <Harness />
      </WorkspaceDialogsProvider>,
    );

    await user.click(view.getByRole("button", { name: "打开新建" }));
    const folder = view.getByRole("combobox", { name: "目录（可选）" });
    await user.click(folder);
    await user.click(view.getByRole("option", { name: "📔 日记" }));
    await user.type(view.getByLabelText("标题"), "天气好{Enter}");

    expect(createNote).toHaveBeenCalledWith({
      title: "天气好",
      extension: "mdx",
      folder: "日记",
      tags: undefined,
    });
  });

  it("creates a note in a newly typed folder", async () => {
    const createNote = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ createNote });
    const user = userEvent.setup();
    const view = render(
      <WorkspaceDialogsProvider>
        <Harness />
      </WorkspaceDialogsProvider>,
    );

    await user.click(view.getByRole("button", { name: "打开新建" }));
    await user.type(view.getByRole("combobox", { name: "目录（可选）" }), "旅行");
    await user.type(view.getByLabelText("标题"), "行程{Enter}");

    expect(createNote).toHaveBeenCalledWith({
      title: "行程",
      extension: "mdx",
      folder: "旅行",
      tags: undefined,
    });
  });

  it("creates a note with multiple tags", async () => {
    const createNote = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      createNote,
      notes: [
        {
          relativePath: "alpha.md",
          fileName: "alpha.md",
          extension: "md",
          modifiedMs: 1,
          size: 1,
          title: "Alpha",
          tags: ["diary", "rust"],
          excerpt: "",
          favorite: false,
        },
      ],
    });
    const user = userEvent.setup();
    const view = render(
      <WorkspaceDialogsProvider>
        <Harness />
      </WorkspaceDialogsProvider>,
    );

    await user.click(view.getByRole("button", { name: "打开新建" }));
    const tags = view.getByRole("combobox", { name: "标签（可选）" });
    await user.click(tags);
    await user.click(view.getByRole("option", { name: "diary" }));
    await user.type(tags, "leetcode{Enter}");
    await user.type(view.getByLabelText("标题"), "天气好{Enter}");

    expect(createNote).toHaveBeenCalledWith({
      title: "天气好",
      extension: "mdx",
      folder: undefined,
      tags: ["diary", "leetcode"],
    });
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

  it("renames a note when Enter is pressed in the path field", async () => {
    const renameNote = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      activePath: "alpha.md",
      renameNote,
    });
    const user = userEvent.setup();
    const view = render(
      <WorkspaceDialogsProvider>
        <Harness />
      </WorkspaceDialogsProvider>,
    );

    await user.click(view.getByRole("button", { name: "打开重命名" }));
    const field = view.getByLabelText("文件名");
    await user.clear(field);
    await user.type(field, "beta.md{Enter}");

    expect(renameNote).toHaveBeenCalledWith("alpha.md", "beta.md");
    await waitFor(() => {
      expect(view.queryByRole("dialog", { name: "重命名笔记" })).not.toBeInTheDocument();
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

  it("deletes a note when Enter is pressed in the confirm dialog", async () => {
    const deleteNote = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
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
      ],
      deleteNote,
    });
    const user = userEvent.setup();
    const view = render(
      <WorkspaceDialogsProvider>
        <Harness />
      </WorkspaceDialogsProvider>,
    );

    await user.click(view.getByRole("button", { name: "打开删除" }));
    expect(view.getByRole("button", { name: "移入回收站" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(deleteNote).toHaveBeenCalledWith("alpha.md");
    await waitFor(() => {
      expect(view.queryByRole("dialog", { name: "删除笔记" })).not.toBeInTheDocument();
    });
  });

  it("falls back to the active note when delete is opened without a path", async () => {
    const deleteNote = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      activePath: "alpha.md",
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
      ],
      deleteNote,
    });
    function ClickHarness() {
      const { openDelete } = useWorkspaceDialogs();
      return (
        <button onClick={() => openDelete()} type="button">
          标题栏删除
        </button>
      );
    }
    const user = userEvent.setup();
    const view = render(
      <WorkspaceDialogsProvider>
        <ClickHarness />
      </WorkspaceDialogsProvider>,
    );

    await user.click(view.getByRole("button", { name: "标题栏删除" }));
    await user.click(view.getByRole("button", { name: "移入回收站" }));
    expect(deleteNote).toHaveBeenCalledWith("alpha.md");
  });
});
