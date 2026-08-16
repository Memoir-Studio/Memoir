import { act, cleanup, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { NoteMeta } from "../../domain/notes";
import { PreviewPane } from "./PreviewPane";

afterEach(cleanup);

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
