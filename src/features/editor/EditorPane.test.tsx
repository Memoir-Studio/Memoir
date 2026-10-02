import { StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { EDITOR_SNAPSHOT_DEBOUNCE_MS, EditorPane, type EditorHandle } from "./EditorPane";

function dispatchedReconfigure(view: EditorView) {
  const dispatch = vi.spyOn(view, "dispatch");
  return {
    dispatch,
    sawReconfigure() {
      return dispatch.mock.calls.some(([spec]) => {
        if (!spec || typeof spec !== "object" || !("effects" in spec)) return false;
        const effects = spec.effects;
        const list = Array.isArray(effects) ? effects : effects ? [effects] : [];
        return list.some((effect) => {
          if (typeof effect !== "object" || effect === null || typeof effect.is !== "function") {
            return false;
          }
          if (effect.is(StateEffect.reconfigure)) return true;
          // CodeMirrorHost reconfigures via Compartment.reconfigure(), not StateEffect.reconfigure.
          const value = "value" in effect ? effect.value : null;
          return Boolean(
            value &&
              typeof value === "object" &&
              "compartment" in value &&
              "extension" in value,
          );
        });
      });
    },
  };
}

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

describe("EditorPane reviewed edits", () => {
  it("flushes live text before capture and isolates reviewed insertions in undo history", () => {
    const onChange = vi.fn();
    const ref = createRef<EditorHandle>();
    render(<EditorPane content="Hello" fileName="hello.md" isDark={false} onChange={onChange} ref={ref} settings={DEFAULT_SETTINGS} />);
    act(() => { ref.current?.insertRaw("typed "); });
    const snapshot = ref.current?.flushContent();
    expect(snapshot).toBe("typed Hello");
    expect(onChange).toHaveBeenLastCalledWith(snapshot);
    act(() => { ref.current?.replaceRange(6, 6, "reviewed ", ""); });
    expect(ref.current?.flushContent()).toBe("typed reviewed Hello");
    act(() => { ref.current?.undo(); });
    expect(ref.current?.flushContent()).toBe("typed Hello");
  });

  it("replaces a captured range only while its source is unchanged", async () => {
    const onChange = vi.fn();
    const ref = createRef<EditorHandle>();
    render(
      <EditorPane
        content="Hello world"
        fileName="hello.md"
        isDark={false}
        onChange={onChange}
        ref={ref}
        settings={DEFAULT_SETTINGS}
      />,
    );

    expect(ref.current?.replaceRange(6, 11, "Memoir", "world")).toBe(true);
    expect(ref.current?.replaceRange(6, 12, "again", "world")).toBe(false);
    await waitFor(() => {
      expect(onChange.mock.calls.some((call) => call[0] === "Hello Memoir")).toBe(true);
    });
  });
});

describe("EditorPane snapshots", () => {
  it("keeps the CodeMirror view when parent callback identities change", async () => {
    const view = render(
      <EditorPane
        content="# Hello"
        fileName="hello.md"
        isDark={false}
        onChange={() => undefined}
        onOpenNote={() => undefined}
        settings={DEFAULT_SETTINGS}
      />,
    );
    await waitFor(() => {
      expect(view.container.querySelector(".cm-md-h1")).toBeTruthy();
    });
    const editor = view.container.querySelector(".cm-editor");
    const heading = view.container.querySelector(".cm-md-h1");
    expect(editor).toBeTruthy();
    const cm = EditorView.findFromDOM(editor as HTMLElement);
    expect(cm).toBeTruthy();
    const watched = dispatchedReconfigure(cm!);
    view.rerender(
      <EditorPane
        content="# Hello"
        fileName="hello.md"
        isDark={false}
        onChange={() => undefined}
        onContextMenu={() => undefined}
        onOpenNote={() => undefined}
        settings={DEFAULT_SETTINGS}
      />,
    );
    expect(watched.sawReconfigure()).toBe(false);
    expect(view.container.querySelector(".cm-editor")).toBe(editor);
    expect(view.container.querySelector(".cm-md-h1")).toBe(heading);
    expect(view.container.querySelector(".cm-md-h1")).toBeTruthy();
  });

  it("debounces document snapshots instead of emitting every edit", async () => {
    const onChange = vi.fn();
    const ref = createRef<EditorHandle>();
    const view = render(
      <EditorPane
        content="# Hello"
        fileName="hello.md"
        isDark={false}
        onChange={onChange}
        ref={ref}
        settings={DEFAULT_SETTINGS}
      />,
    );
    await waitFor(() => {
      expect(view.container.querySelector(".cm-content")).toBeTruthy();
    });
    vi.useFakeTimers();
    act(() => {
      ref.current?.insertRaw("!");
    });
    expect(onChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(EDITOR_SNAPSHOT_DEBOUNCE_MS);
    });
    expect(onChange.mock.calls.some((call) => String(call[0]).includes("!"))).toBe(true);
    vi.useRealTimers();
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
