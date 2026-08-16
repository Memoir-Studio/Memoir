import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { EditorPane } from "./EditorPane";

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

describe("EditorPane image insert", () => {
  it("saves pasted clipboard images and inserts markdown", async () => {
    const onPasteImages = vi.fn().mockResolvedValue("![shot](.memoir-attachments/2026-08/shot.png)");
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
          String(call[0]).includes("![shot](.memoir-attachments/2026-08/shot.png)"),
        ),
      ).toBe(true);
    });
  });

  it("saves dropped image files at the caret", async () => {
    const onPasteImages = vi.fn().mockResolvedValue("![drop](.memoir-attachments/2026-08/drop.png)");
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
          String(call[0]).includes("![drop](.memoir-attachments/2026-08/drop.png)"),
        ),
      ).toBe(true);
    });
  });
});
