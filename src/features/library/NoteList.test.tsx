import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setGatewaysForTests } from "../../gateways";
import { useAppStore } from "../../store/app-store";
import { createMockGateways } from "../../test/mock-gateways";
import { exportNotePdf } from "../export/export-note-pdf";
import { NoteList } from "./NoteList";

vi.mock("../export/export-note-pdf", () => ({
  exportNotePdf: vi.fn(),
}));

afterEach(() => {
  cleanup();
  setGatewaysForTests(null);
  useAppStore.setState({
    workspaceRoot: null,
    notes: [],
    libraryStats: {
      total: 0,
      recent: 0,
      favorites: 0,
      uncategorized: 0,
      folders: [],
      tags: [],
      truncated: false,
    },
    activePath: null,
    loadedContentPath: null,
    content: "",
    savedContent: "",
    query: "",
    navFilter: "all",
    scopedFilter: null,
    libraryPanelMode: "notes",
    attachments: [],
  });
});

describe("NoteList", () => {
  it("renders the current query page without client-side refiltering", async () => {
    useAppStore.setState({
      notes: [
        {
          relativePath: "beta.mdx",
          fileName: "beta.mdx",
          extension: "mdx",
          modifiedMs: 2,
          size: 20,
          title: "Beta Notes",
          tags: ["ideas"],
          excerpt: "Another document",
          favorite: false,
        },
      ],
      query: "beta",
      activePath: "beta.mdx",
      loadedContentPath: "beta.mdx",
      content: "# Beta Notes",
      savedContent: "# Beta Notes",
    });
    const view = render(
      <NoteList
        onCreate={() => undefined}
        onDelete={() => undefined}
        onRename={() => undefined}
      />,
    );

    expect(view.queryByText("Alpha Guide")).not.toBeInTheDocument();
    expect(view.getByText("Beta Notes")).toBeInTheDocument();
    expect(view.getByText("1 篇")).toBeInTheDocument();
    expect(view.getByRole("searchbox", { name: "筛选笔记" })).toHaveValue("beta");
  });

  it("mounts only the virtual window when the page is long", () => {
    useAppStore.setState({
      notes: Array.from({ length: 120 }, (_, index) => ({
        relativePath: `n${index}.md`,
        fileName: `n${index}.md`,
        extension: "md" as const,
        modifiedMs: index,
        size: 10,
        title: `Note ${index}`,
        tags: [],
        excerpt: "",
        favorite: false,
      })),
    });
    const view = render(
      <NoteList
        onCreate={() => undefined}
        onDelete={() => undefined}
        onRename={() => undefined}
      />,
    );
    const cards = view.container.querySelectorAll("[data-note-card]");
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThan(120);
    expect(view.queryByText("Note 0")).toBeInTheDocument();
    expect(view.queryByText("Note 119")).not.toBeInTheDocument();
  });

  it("shows the current note outline when switching panels", async () => {
    useAppStore.setState({
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
      content: "# Alpha Guide\n## Setup\n### Install",
      savedContent: "# Alpha Guide\n## Setup\n### Install",
      libraryPanelMode: "notes",
    });
    const user = userEvent.setup();
    const view = render(
      <NoteList
        onCreate={() => undefined}
        onDelete={() => undefined}
        onRename={() => undefined}
      />,
    );

    await user.click(view.getByRole("button", { name: "大纲" }));

    expect(view.getByRole("navigation", { name: "大纲" })).toBeInTheDocument();
    expect(view.getByRole("button", { name: "Alpha Guide" })).toHaveAttribute(
      "aria-current",
      "location",
    );
    expect(view.getByRole("button", { name: "Install" })).toHaveAttribute("data-depth", "3");
  });

  it("shows the attachment library from the sidebar, not a duplicate header tab", () => {
    useAppStore.setState({
      attachments: [
        {
          relativePath: "attachments/shot.png",
          fileName: "shot.png",
          extension: "png",
          mimeType: "image/png",
          modifiedMs: 1,
          size: 12,
        },
      ],
      libraryPanelMode: "attachments",
    });
    const view = render(
      <NoteList
        onCreate={() => undefined}
        onDelete={() => undefined}
        onRename={() => undefined}
      />,
    );

    expect(view.queryByRole("button", { name: "附件" })).not.toBeInTheDocument();
    expect(view.getByText("shot.png")).toBeInTheDocument();
    expect(view.getByRole("button", { name: "导入图片" })).toBeInTheDocument();
  });

  it("shows the index inspector from the sidebar, not a duplicate header tab", async () => {
    const gateways = createMockGateways();
    setGatewaysForTests(gateways);
    useAppStore.setState({
      workspaceRoot: "/workspace",
      libraryPanelMode: "index",
    });
    const view = render(
      <NoteList
        onCreate={() => undefined}
        onDelete={() => undefined}
        onRename={() => undefined}
      />,
    );

    expect(view.queryByRole("button", { name: "笔记" })).not.toBeInTheDocument();
    expect(view.getByRole("heading", { name: "索引" })).toBeInTheDocument();
    await waitFor(() => {
      expect(view.getByText("磁盘缓存")).toBeInTheDocument();
    });
    expect(view.getByRole("button", { name: "重建索引" })).toBeInTheDocument();
  });

  it("shows the cloud sync panel from the sidebar", async () => {
    useAppStore.setState({
      workspaceRoot: "/workspace",
      libraryPanelMode: "sync",
    });
    const user = userEvent.setup();
    const view = render(
      <NoteList
        onCreate={() => undefined}
        onDelete={() => undefined}
        onRename={() => undefined}
      />,
    );

    expect(view.queryByRole("button", { name: "笔记" })).not.toBeInTheDocument();
    expect(view.getByRole("heading", { name: "云同步" })).toBeInTheDocument();
    expect(view.getByText(/目前支持 WebDAV/)).toBeInTheDocument();
    await user.type(
      view.getByPlaceholderText("https://dav.example.com/remote.php/dav/"),
      "https://dav.example/dav",
    );
    expect(view.getByDisplayValue("https://dav.example/dav")).toBeInTheDocument();
  });

  it("opens a note context menu for rename, favorite and delete", async () => {
    const onRename = vi.fn();
    const onDelete = vi.fn();
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
          tags: ["docs"],
          excerpt: "Searchable content",
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
      <NoteList onCreate={() => undefined} onDelete={onDelete} onRename={onRename} />,
    );
    const card = view.getByRole("button", { name: "Alpha Guide" });

    fireEvent.contextMenu(card, { clientX: 24, clientY: 48 });

    expect(view.getByRole("menu", { name: "Alpha Guide 的操作" })).toBeInTheDocument();
    expect(card).toHaveAttribute("aria-expanded", "true");

    await user.click(view.getByRole("menuitem", { name: "收藏" }));
    expect(useAppStore.getState().notes[0]?.favorite).toBe(true);

    fireEvent.contextMenu(card, { clientX: 24, clientY: 48 });
    await user.click(view.getByRole("menuitem", { name: "重命名" }));
    expect(onRename).toHaveBeenCalledWith("alpha.md");

    fireEvent.contextMenu(card, { clientX: 24, clientY: 48 });
    await user.click(view.getByRole("menuitem", { name: "删除" }));
    expect(onDelete).toHaveBeenCalledWith("alpha.md");
  });

  it("reveals the note in the system file manager from the context menu", async () => {
    const gateways = createMockGateways();
    const revealed: string[] = [];
    gateways.workspace.revealPath = async (path) => {
      revealed.push(path);
    };
    setGatewaysForTests(gateways);
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
          tags: ["docs"],
          excerpt: "Searchable content",
          favorite: false,
        },
      ],
    });
    const user = userEvent.setup();
    const view = render(
      <NoteList onCreate={() => undefined} onDelete={() => undefined} onRename={() => undefined} />,
    );

    fireEvent.contextMenu(view.getByRole("button", { name: "Alpha Guide" }), {
      clientX: 24,
      clientY: 48,
    });
    await user.click(view.getByRole("menuitem", { name: "在系统中打开" }));
    expect(revealed).toEqual(["/workspace/alpha.md"]);
  });

  it("exports the note as PDF from the context menu", async () => {
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
          tags: ["docs"],
          excerpt: "Searchable content",
          favorite: false,
        },
      ],
    });
    const user = userEvent.setup();
    const view = render(
      <NoteList onCreate={() => undefined} onDelete={() => undefined} onRename={() => undefined} />,
    );

    fireEvent.contextMenu(view.getByRole("button", { name: "Alpha Guide" }), {
      clientX: 24,
      clientY: 48,
    });
    await user.click(view.getByRole("menuitem", { name: "导出 PDF" }));
    expect(exportNotePdf).toHaveBeenCalledWith("alpha.md");
  });
});
