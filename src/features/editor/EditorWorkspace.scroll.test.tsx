import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { useAppStore } from "../../store/app-store";

const scrollHarness = vi.hoisted(() => ({
  editorScroller: null as HTMLElement | null,
  scrollToLine: vi.fn<(line: number) => void>(),
  visibleLine: 20,
}));

vi.mock("./EditorPane", async () => {
  const React = await import("react");
  const MockEditorPane = React.forwardRef(function MockEditorPane(
    props: { onScroll?: () => void; onScrollIntent?: () => void },
    ref: React.ForwardedRef<unknown>,
  ) {
    const scrollerRef = React.useRef<HTMLDivElement>(null);
    React.useImperativeHandle(ref, () => ({
      getScrollElement: () => scrollerRef.current,
      getVisibleLine: () => scrollHarness.visibleLine,
      scrollToLine: (line: number) => {
        scrollHarness.scrollToLine(line);
        if (scrollerRef.current) scrollerRef.current.scrollTop = line * 10;
      },
      insertSnippet: () => undefined,
      insertText: () => undefined,
      insertTextAtCoords: () => undefined,
      insertRaw: () => undefined,
      undo: () => undefined,
      redo: () => undefined,
      selectAll: () => undefined,
      getSelectedText: () => "",
      cut: async () => undefined,
      copy: async () => undefined,
    }));
    React.useEffect(() => {
      scrollHarness.editorScroller = scrollerRef.current;
      return () => {
        scrollHarness.editorScroller = null;
      };
    }, []);
    return React.createElement("div", {
      "data-testid": "editor-scroller",
      onPointerDown: props.onScrollIntent,
      onScroll: props.onScroll,
      onWheel: props.onScrollIntent,
      ref: scrollerRef,
    });
  });
  return { default: MockEditorPane };
});

vi.mock("../preview/PreviewPane", async () => {
  const React = await import("react");
  function MockPreviewPane(props: {
    articleRef?: React.Ref<HTMLElement | null>;
    onScroll?: () => void;
    onScrollIntent?: () => void;
    paneRef?: React.RefObject<HTMLElement | null>;
  }) {
    return React.createElement(
      "section",
      {
        "data-testid": "preview-scroller",
        onPointerDown: props.onScrollIntent,
        onScroll: props.onScroll,
        onWheel: props.onScrollIntent,
        ref: props.paneRef,
      },
      React.createElement("article", { ref: props.articleRef }),
    );
  }
  return { default: MockPreviewPane };
});

import { EditorWorkspace } from "./EditorWorkspace";

const defaultResizeObserver = window.ResizeObserver;

function setScrollGeometry(element: HTMLElement, clientHeight: number, scrollHeight: number) {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: clientHeight },
    scrollHeight: { configurable: true, value: scrollHeight },
  });
}

afterEach(() => {
  cleanup();
  window.ResizeObserver = defaultResizeObserver;
  scrollHarness.scrollToLine.mockReset();
  scrollHarness.visibleLine = 20;
  useAppStore.setState({
    workspaceRoot: null,
    notes: [],
    activePath: null,
    loadedContentPath: null,
    content: "",
    savedContent: "",
    viewMode: DEFAULT_SETTINGS.editor.defaultView,
  });
});

describe("EditorWorkspace synchronized scrolling", () => {
  it("keeps both user-controlled directions active", async () => {
    const frames: FrameRequestCallback[] = [];
    const resizeCallbacks: ResizeObserverCallback[] = [];
    window.ResizeObserver = class ResizeObserverMock implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallbacks.push(callback);
      }
      disconnect() {}
      observe() {}
      takeRecords() { return []; }
      unobserve() {}
    };
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const content = Array.from({ length: 40 }, (_, index) => `Line ${index + 1}`).join("\n");
    useAppStore.setState({
      workspaceRoot: null,
      notes: [
        {
          relativePath: "alpha.md",
          fileName: "alpha.md",
          extension: "md",
          modifiedMs: 1,
          size: content.length,
          title: "Alpha",
          tags: [],
          excerpt: "",
          favorite: false,
        },
      ],
      activePath: "alpha.md",
      loadedContentPath: "alpha.md",
      content,
      savedContent: content,
      viewMode: "split",
    });

    const view = render(
      <EditorWorkspace isDark={false} onDelete={() => undefined} onRename={() => undefined} />,
    );
    const editor = await waitFor(() => view.getByTestId("editor-scroller"));
    const preview = view.getByTestId("preview-scroller");
    setScrollGeometry(editor, 400, 1600);
    setScrollGeometry(preview, 400, 2000);

    fireEvent.scroll(editor);
    act(() => frames.shift()?.(0));
    expect(preview.scrollTop).toBeGreaterThan(0);

    // Consume every preview event produced by the editor-driven update.
    fireEvent.scroll(preview);
    // Repeated events from the same programmatic write must also stay suppressed.
    fireEvent.scroll(preview);
    fireEvent.wheel(preview);
    preview.scrollTop = 1200;
    fireEvent.scroll(preview);
    act(() => {
      for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
    });
    expect(preview.scrollTop).toBe(1200);
    act(() => frames.shift()?.(16));

    expect(scrollHarness.scrollToLine).toHaveBeenCalledTimes(1);
    expect(scrollHarness.scrollToLine.mock.calls[0]?.[0]).toBeGreaterThan(25);

    // CodeMirror may emit multiple scroll events while correcting its virtual viewport.
    fireEvent.scroll(editor);
    fireEvent.scroll(editor);
    expect(frames).toHaveLength(0);

    // Explicit interaction transfers ownership immediately, even while a guard is active.
    fireEvent.wheel(editor);
    scrollHarness.visibleLine = 32;
    fireEvent.scroll(editor);
    expect(frames).toHaveLength(1);
    act(() => frames.shift()?.(32));
    expect(preview.scrollTop).toBeGreaterThan(1200);
  });
});
