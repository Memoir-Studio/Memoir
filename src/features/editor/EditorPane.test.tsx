import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { EditorPane, type EditorHandle } from "./EditorPane";

afterEach(cleanup);

function clipboardData(file: File) {
  return {
    items: [
      {
        kind: "file",
        type: file.type,
        getAsFile: () => file,
      },
    ],
    files: [file],
    types: ["Files"],
    dropEffect: "none",
  };
}

describe("EditorPane context menu", () => {
  it("opens a context menu target from the editor surface", () => {
    const onContextMenu = vi.fn();
    const view = render(
      <EditorPane
        content="# Hello"
        fileName="hello.md"
        isDark={false}
        onChange={() => undefined}
        onContextMenu={onContextMenu}
        settings={DEFAULT_SETTINGS}
      />,
    );
    const content = view.container.querySelector(".cm-content");
    fireEvent.contextMenu(content as Element, { clientX: 48, clientY: 64 });
    expect(onContextMenu).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 48,
        y: 64,
        hasSelection: false,
      }),
    );
  });

  it("selects the whole document from the editor handle", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const ref = createRef<EditorHandle>();
    const view = render(
      <EditorPane
        content="# Hello"
        fileName="hello.md"
        isDark={false}
        onChange={() => undefined}
        ref={ref}
        settings={DEFAULT_SETTINGS}
      />,
    );

    ref.current?.selectAll();
    expect(ref.current?.getSelectedText()).toBe("# Hello");
    await ref.current?.copy();
    expect(writeText).toHaveBeenCalledWith("# Hello");
    fireEvent.mouseDown(view.container.querySelector(".cm-content") as Element);
    expect(ref.current?.getSelectedText()).toBe("# Hello");
    expect(view.container.querySelector(".cm-content")?.textContent).toContain("Hello");
  });
});

describe("EditorPane source chrome", () => {
  it("keeps the source pane on the same canvas as the preview", () => {
    const view = render(
      <EditorPane
        content="# Hello"
        fileName="hello.md"
        isDark={false}
        onChange={() => undefined}
        settings={DEFAULT_SETTINGS}
      />,
    );
    expect(view.container.querySelector(".editor-pane")).toHaveClass("bg-canvas");
  });

  it("keeps ATX heading marks on the same line as the heading text", async () => {
    const view = render(
      <EditorPane
        content="# 测试"
        fileName="hello.md"
        isDark={false}
        onChange={() => undefined}
        settings={DEFAULT_SETTINGS}
      />,
    );

    await waitFor(() => {
      const heading = view.container.querySelector(".cm-md-h1");
      expect(heading).toBeTruthy();
      const line = heading?.closest(".cm-line");
      expect(line?.querySelector(".cm-md-mark")?.textContent).toContain("#");
    });
  });

  it("highlights markdown structure instead of rendering flat text", async () => {
    const view = render(
      <EditorPane
        content={"## Title\n\n**bold** and `code`\n\n- [ ] item"}
        fileName="hello.md"
        isDark={false}
        onChange={() => undefined}
        settings={DEFAULT_SETTINGS}
      />,
    );

    await waitFor(() => {
      expect(view.container.querySelector(".cm-md-h2")).toBeTruthy();
      expect(view.container.querySelector(".cm-md-strong")).toBeTruthy();
      expect(view.container.querySelector(".cm-md-code")).toBeTruthy();
      expect(view.container.querySelector(".cm-md-mark")).toBeTruthy();
    });
  });

  it("highlights fenced python in the source editor", async () => {
    const view = render(
      <EditorPane
        content={"```python\ndef main():\n    pass\n```"}
        fileName="hello.md"
        isDark={false}
        onChange={() => undefined}
        settings={DEFAULT_SETTINGS}
      />,
    );

    await waitFor(() => {
      expect(view.container.querySelector(".cm-code-keyword")).toBeTruthy();
      expect(view.container.querySelector(".cm-md-codeblock")).toBeTruthy();
    });
  });
});

describe("EditorPane image insert", () => {
  it("saves pasted clipboard images and inserts markdown", async () => {
    const onPasteImages = vi.fn().mockResolvedValue("![shot](attachments/2026-08/shot.png)");
    const onChange = vi.fn();
    const view = render(
      <EditorPane
        content="# Hello"
        fileName="hello.md"
        isDark={false}
        onChange={onChange}
        onPasteImages={onPasteImages}
        settings={DEFAULT_SETTINGS}
      />,
    );
    const file = new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" });
    const content = view.container.querySelector(".cm-content");
    expect(content).toBeTruthy();
    fireEvent.paste(content as Element, { clipboardData: clipboardData(file) });

    await waitFor(() => {
      expect(onPasteImages).toHaveBeenCalledWith([file]);
    });
    await waitFor(() => {
      expect(
        onChange.mock.calls.some((call) =>
          String(call[0]).includes("![shot](attachments/2026-08/shot.png)"),
        ),
      ).toBe(true);
    });
  });

  it("saves dropped image files at the caret", async () => {
    const onPasteImages = vi.fn().mockResolvedValue("![drop](attachments/2026-08/drop.png)");
    const onChange = vi.fn();
    const view = render(
      <EditorPane
        content="# Hello"
        fileName="hello.md"
        isDark={false}
        onChange={onChange}
        onPasteImages={onPasteImages}
        settings={DEFAULT_SETTINGS}
      />,
    );
    const file = new File([new Uint8Array([9, 8, 7])], "drop.png", { type: "image/png" });
    const content = view.container.querySelector(".cm-content");
    fireEvent.drop(content as Element, { dataTransfer: clipboardData(file), clientX: 20, clientY: 20 });

    await waitFor(() => {
      expect(onPasteImages).toHaveBeenCalledWith([file]);
    });
    await waitFor(() => {
      expect(
        onChange.mock.calls.some((call) =>
          String(call[0]).includes("![drop](attachments/2026-08/drop.png)"),
        ),
      ).toBe(true);
    });
  });
});
