import { act, cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NoteMeta } from "../../domain/notes";
import { setGatewaysForTests } from "../../gateways";
import { useAppStore } from "../../store/app-store";
import { createMockGateways } from "../../test/mock-gateways";
import { MARKDOWN_PREVIEW_DELAY_MS } from "./NotePreviewArticle";
import { LONG_NOTE_DEFER_THRESHOLD } from "../editor/editor-performance";
import { PreviewPane } from "./PreviewPane";
import { resetLinkPreviewCache } from "./link-preview-cache";
import { resetMermaidRuntime } from "./mermaid-runtime";

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async () => ({ svg: "<svg data-test='mermaid'></svg>" })),
}));

vi.mock("mermaid", () => ({
  default: mermaidMock,
}));

afterEach(() => {
  cleanup();
  resetMermaidRuntime();
  resetLinkPreviewCache();
  mermaidMock.initialize.mockClear();
  mermaidMock.render.mockClear();
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

describe("PreviewPane link cards", () => {
  it("paints a lightweight pending state before rendering a long note", () => {
    const content = `# Long note\n\n${"x".repeat(LONG_NOTE_DEFER_THRESHOLD)}`;
    const view = render(
      <PreviewPane
        activePath="long.md"
        content={content}
        note={{ ...note, relativePath: "long.md", fileName: "long.md", size: content.length }}
        onContentChange={() => undefined}
        root={null}
      />,
    );

    expect(view.container.querySelector("[data-preview-pending]")).toHaveTextContent(
      "正在生成预览…",
    );
  });

  it("renders a standalone http(s) URL as a metadata card", async () => {
    const url = "https://shiyu.dev/article/320";
    const gateways = createMockGateways();
    gateways.workspace.linkPreviewHtml.set(
      url,
      [
        "<html><head>",
        '<meta property="og:title" content="面壁实习" />',
        '<meta property="og:description" content="十月假期后我开始找实习，面试顺利并选择了面壁智能。" />',
        '<meta property="og:image" content="https://shiyu.dev/cover.png" />',
        '<meta property="og:site_name" content="shiyu.dev" />',
        "</head></html>",
      ].join(""),
    );
    setGatewaysForTests(gateways);
    const view = render(
      <PreviewPane
        activePath="memoir.mdx"
        content={`${url}\n`}
        note={note}
        onContentChange={() => undefined}
        root="/notes"
      />,
    );

    const card = await waitFor(() => {
      const link = view.getByRole("link", { name: /面壁实习/ });
      expect(link).toHaveAttribute("data-link-card");
      return link;
    });
    expect(card).toHaveAttribute("href", url);
    expect(card.querySelector('[data-link-card-part="description"]')?.textContent).toContain(
      "十月假期后我开始找实习",
    );
    expect(card.querySelector('[data-link-card-part="host"]')?.textContent).toBe("shiyu.dev");
    expect(view.container.querySelector('[data-link-card-part="image"]')).toHaveAttribute(
      "src",
      "https://shiyu.dev/cover.png",
    );

    const user = userEvent.setup();
    const openExternal = vi.spyOn(gateways.workspace, "openExternal");
    await user.click(card);
    expect(openExternal).toHaveBeenCalledWith(url);
  });

  it("keeps an inline URL as a normal link", () => {
    const view = render(
      <PreviewPane
        activePath="tasks.md"
        content={"See https://example.com/docs for more.\n"}
        note={note}
        onContentChange={() => undefined}
        root="/notes"
      />,
    );
    const link = view.getByRole("link", { name: "https://example.com/docs" });
    expect(link).not.toHaveAttribute("data-link-card");
    expect(view.container.querySelector("[data-link-card]")).toBeNull();
  });
});

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

describe("PreviewPane fenced code", () => {
  it("highlights python tokens in a fenced code block", () => {
    const view = render(
      <PreviewPane
        activePath="hello.md"
        content={"```python\ndef main():\n    pass\n```\n"}
        note={{ ...note, relativePath: "hello.md", fileName: "hello.md", title: "Hello" }}
        onContentChange={() => undefined}
        root="/notes"
      />,
    );

    expect(view.container.querySelector(".hljs-keyword")).toBeTruthy();
    expect(view.container.querySelector("code.language-python, code.hljs")).toBeTruthy();
  });

  it("leaves mermaid fences for the diagram renderer", () => {
    const view = render(
      <PreviewPane
        activePath="hello.md"
        content={"```mermaid\ngraph LR\nA-->B\n```\n"}
        note={{ ...note, relativePath: "hello.md", fileName: "hello.md", title: "Hello" }}
        onContentChange={() => undefined}
        root="/notes"
      />,
    );

    expect(view.container.querySelector("[data-mermaid-pending]")).toBeTruthy();
    expect(view.container.querySelector(".hljs-keyword")).toBeNull();
  });

  it("does not re-initialize mermaid when the fence source is unchanged", async () => {
    const props = {
      activePath: "hello.md",
      content: "```mermaid\ngraph LR\nA-->B\n```\n",
      note: { ...note, relativePath: "hello.md", fileName: "hello.md", title: "Hello" },
      onContentChange: () => undefined,
      root: "/notes",
    };
    const view = render(<PreviewPane {...props} />);
    await waitFor(() => {
      expect(mermaidMock.render).toHaveBeenCalledTimes(1);
    });
    expect(mermaidMock.initialize).toHaveBeenCalledTimes(1);

    view.rerender(<PreviewPane {...props} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mermaidMock.initialize).toHaveBeenCalledTimes(1);
    expect(mermaidMock.render).toHaveBeenCalledTimes(1);
  });
});

describe("PreviewPane layout", () => {
  it("exposes stable pane and article landmarks", () => {
    const view = render(
      <PreviewPane
        activePath="hello.md"
        content={"# Title\n\nParagraph\n"}
        note={{ ...note, relativePath: "hello.md", fileName: "hello.md", title: "Title" }}
        onContentChange={() => undefined}
        root="/notes"
      />,
    );

    const pane = view.getByRole("region");
    const article = pane.querySelector("article");
    expect(pane).toHaveAttribute("data-preview-pane", "");
    expect(article).toHaveAttribute("data-preview-root", "");
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
  it("keeps adjacent markdown images in the same paragraph", () => {
    const view = render(
      <PreviewPane
        activePath="readme.md"
        content={"![MIT](https://img.shields.io/badge/license-MIT-d65f4d) ![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB)\n"}
        note={{ ...note, relativePath: "readme.md", fileName: "readme.md", title: "Readme" }}
        onContentChange={() => undefined}
        root="/notes"
      />,
    );

    const images = view.getAllByRole("img");
    expect(images).toHaveLength(2);
    expect(images[0].parentElement).toBe(images[1].parentElement);
    expect(images[0].parentElement?.tagName).toBe("P");
  });

  it("keeps adjacent HTML badge images in the same paragraph", () => {
    const view = render(
      <PreviewPane
        activePath="readme.md"
        content={[
          '<p align="center">',
          '  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-d65f4d" />',
          '  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24C8DB" />',
          "</p>",
          "",
        ].join("\n")}
        note={{ ...note, relativePath: "readme.md", fileName: "readme.md", title: "Readme" }}
        onContentChange={() => undefined}
        root="/notes"
      />,
    );

    const images = view.getAllByRole("img");
    expect(images).toHaveLength(2);
    expect(images[0].compareDocumentPosition(images[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(images[0].closest("p")).toBe(images[1].closest("p"));
  });

  it("keeps adjacent HTML badge images in the same paragraph when compiled as MDX", async () => {
    const view = render(
      <PreviewPane
        activePath="readme.mdx"
        content={[
          "<Badge>local</Badge>",
          "",
          '<p align="center">',
          '  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-d65f4d" />',
          '  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2-24C8DB" />',
          "</p>",
          "",
        ].join("\n")}
        note={{
          ...note,
          relativePath: "readme.mdx",
          fileName: "readme.mdx",
          extension: "mdx",
          title: "Readme",
        }}
        onContentChange={() => undefined}
        root="/notes"
      />,
    );

    const images = await view.findAllByRole("img", {}, { timeout: 1500 });
    expect(images).toHaveLength(2);
    expect(images[0].closest("p")).toBe(images[1].closest("p"));
  });

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
});
