import { cleanup, fireEvent, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../../store/app-store";
import { NoteList } from "./NoteList";

afterEach(() => {
  cleanup();
  useAppStore.setState({
    workspaceRoot: null,
    notes: [],
    activePath: null,
    loadedContentPath: null,
    content: "",
    savedContent: "",
    query: "",
    navFilter: "all",
    scopedFilter: null,
    libraryPanelMode: "notes",
  });
});

describe("NoteList", () => {
  it("filters rendered notes from search input", async () => {
    useAppStore.setState({
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
      activePath: "alpha.md",
      loadedContentPath: "alpha.md",
      content: "# Alpha Guide",
      savedContent: "# Alpha Guide",
    });
    const user = userEvent.setup();
    const view = render(
      <NoteList
        onCreate={() => undefined}
        onDelete={() => undefined}
        onRename={() => undefined}
      />,
    );

    expect(view.getByText("Alpha Guide")).toBeInTheDocument();
    expect(view.getByText("Beta Notes")).toBeInTheDocument();

    await user.type(view.getByRole("searchbox", { name: "筛选笔记" }), "beta");

    expect(view.queryByText("Alpha Guide")).not.toBeInTheDocument();
    expect(view.getByText("Beta Notes")).toBeInTheDocument();
    expect(view.getByText("1 篇")).toBeInTheDocument();
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
});
