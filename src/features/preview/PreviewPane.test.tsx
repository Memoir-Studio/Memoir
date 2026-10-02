import { act, cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteMeta } from "../../domain/notes";
import { setGatewaysForTests } from "../../gateways";
import { useAppStore } from "../../store/app-store";
import { createMockGateways } from "../../test/mock-gateways";
import { MARKDOWN_PREVIEW_DELAY_MS } from "./NotePreviewArticle";
import { PreviewPane } from "./PreviewPane";

afterEach(() => {
  cleanup();
  setGatewaysForTests(null);
  useAppStore.setState({
    workspaceRoot: null,
    activePath: null,
    content: "",
    savedContent: "",
  });
});

const note: NoteMeta = {
  relativePath: "tasks.md",
  fileName: "tasks.md",
  extension: "md",
  modifiedMs: 1,
  size: 20,
  title: "Tasks",
  tags: [],
  excerpt: "",
  favorite: false,
};

describe("PreviewPane wiki links", () => {
  it("opens a resolved wiki link in the workspace", async () => {
    const gateways = createMockGateways();
    gateways.workspace.files.set("tasks.md", "See [[One]].\n");
    gateways.workspace.files.set("one.md", "# One\n");
    setGatewaysForTests(gateways);
    const selectNote = vi.fn(async () => undefined);
    useAppStore.setState({
      workspaceRoot: "/notes",
      activePath: "tasks.md",
      content: "See [[One]].\n",
      savedContent: "See [[One]].\n",
      selectNote,
    });
    const view = render(
      <PreviewPane
        activePath="tasks.md"
        content="See [[One]].\n"
        note={note}
        onContentChange={() => undefined}
        root="/notes"
      />,
    );
    const user = userEvent.setup();
    await waitFor(() => {
      expect(view.getByRole("link", { name: "One" })).not.toHaveAttribute(
        "data-wiki-link-missing",
      );
    });
    await user.click(view.getByRole("link", { name: "One" }));
    expect(selectNote).toHaveBeenCalledWith("one.md");
  });
});

describe("PreviewPane task list", () => {
  it("updates the matching Markdown task when a preview checkbox is clicked", async () => {
    const content = [
      "---",
      "title: Tasks",
      "---",
      "- [ ] 重复任务",
      "- [ ] 重复任务",
      "",
    ].join("\n");
    let updatedContent = "";
    const view = render(
      <PreviewPane
        activePath="tasks.md"
        content={content}
        note={note}
        onContentChange={(value) => {
          updatedContent = value;
        }}
        root="/notes"
      />,
    );
    const user = userEvent.setup();
    const checkboxes = view.getAllByRole("checkbox", { name: "切换任务状态" });
    expect(view.container.querySelector("ul.contains-task-list")).toBeTruthy();
    expect(view.container.querySelectorAll("li.task-list-item")).toHaveLength(2);

    await user.click(checkboxes[1]);

    expect(updatedContent).toBe(
      [
        "---",
        "title: Tasks",
        "---",
        "- [ ] 重复任务",
        "- [x] 重复任务",
        "",
      ].join("\n"),
    );
  });

  it("keeps task checkboxes interactive when the MDX compiler is active", async () => {
    const mdxNote = { ...note, extension: "mdx" as const, fileName: "tasks.mdx" };
    const content = ["<Badge>MDX</Badge>", "", "- [ ] MDX 任务", ""].join("\n");
    let updatedContent = "";
    const view = render(
      <PreviewPane
        activePath="tasks.mdx"
        content={content}
        note={mdxNote}
        onContentChange={(value) => {
          updatedContent = value;
        }}
        root="/notes"
      />,
    );
    const user = userEvent.setup();
    const checkbox = await view.findByRole(
      "checkbox",
      { name: "切换任务状态" },
      { timeout: 1500 },
    );

    await user.click(checkbox);

    expect(updatedContent).toBe(["<Badge>MDX</Badge>", "", "- [x] MDX 任务", ""].join("\n"));
  });
});

describe("PreviewPane markdown delay", () => {
  it("keeps the previous markdown body until the preview delay elapses", async () => {
    vi.useFakeTimers();
    const view = render(
      <PreviewPane
        activePath="hello.md"
        content={"# Title\n\nParagraph\n"}
        note={{ ...note, relativePath: "hello.md", fileName: "hello.md", title: "Title" }}
        onContentChange={() => undefined}
        root="/notes"
      />,
    );
    expect(view.getByRole("heading", { name: "Title" })).toBeInTheDocument();

    view.rerender(
      <PreviewPane
        activePath="hello.md"
        content={"# Next\n\nUpdated\n"}
        note={{ ...note, relativePath: "hello.md", fileName: "hello.md", title: "Next" }}
        onContentChange={() => undefined}
        root="/notes"
      />,
    );
    expect(view.getByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(view.queryByRole("heading", { name: "Next" })).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MARKDOWN_PREVIEW_DELAY_MS);
    });
    expect(view.getByRole("heading", { name: "Next" })).toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe("PreviewPane source lines", () => {
  it("tags rendered blocks with markdown source lines", () => {
    const view = render(
      <PreviewPane
        activePath="hello.md"
        content={"# Title\n\nParagraph\n"}
        note={{ ...note, relativePath: "hello.md", fileName: "hello.md", title: "Title" }}
        onContentChange={() => undefined}
        root="/notes"
      />,
    );

    expect(view.getByRole("heading", { name: "Title" })).toHaveAttribute("data-source-line", "1");
    expect(view.getByText("Paragraph")).toHaveAttribute("data-source-line", "3");
  });
});

describe("PreviewPane images", () => {
  it("resolves percent-encoded local attachment images in MDX notes", async () => {
    const view = render(
      <PreviewPane
        activePath="two.mdx"
        content={["$$", String.raw`\sum_{i=1}^{n} i`, "$$", "", "![截图](attachments/截图.png)", ""].join(
          "\n",
        )}
        note={{
          ...note,
          relativePath: "two.mdx",
          fileName: "two.mdx",
          extension: "mdx",
          title: "Two Sum",
        }}
        onContentChange={() => undefined}
        root="/notes"
      />,
    );

    // MDX compile is debounced 350ms; the compiled tree percent-encodes CJK hrefs.
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 600)));
    expect(view.getByRole("img", { name: "截图" })).toHaveAttribute(
      "src",
      "/notes/attachments/截图.png",
    );
  });

  it("serves local images from Windows extended-length workspace paths", () => {
    const view = render(
      <PreviewPane
        activePath="readme.md"
        content="![截图](attachments/截图.png)"
        note={{ ...note, relativePath: "readme.md", fileName: "readme.md", title: "Readme" }}
        onContentChange={() => undefined}
        root={String.raw`\\?\D:\projects\notes`}
      />,
    );

    expect(view.getByRole("img", { name: "截图" })).toHaveAttribute(
      "src",
      "D:/projects/notes/attachments/截图.png",
    );
  });
});
