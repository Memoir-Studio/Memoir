import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { EditorSelection } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { clamp } from "./scroll-sync";
import { collectClipboardImages, padMarkdownBlock } from "../../domain/attachments";
import type { AppSettings } from "../../domain/settings";
import { useI18n } from "../../i18n/react";
import { noteStats, parseNote } from "../library/note-utils";
import { cn, Tag } from "../../components/ui";

function positionFromCoords(view: EditorView, x: number, y: number) {
  try {
    return view.posAtCoords({ x, y }) ?? view.state.selection.main.from;
  } catch {
    return view.state.selection.main.from;
  }
}

function insertAt(view: EditorView, from: number, to: number, text: string) {
  const insertFrom = Math.min(from, view.state.doc.length);
  const insertTo = Math.min(Math.max(to, insertFrom), view.state.doc.length);
  view.dispatch({
    changes: { from: insertFrom, to: insertTo, insert: text },
    selection: EditorSelection.cursor(insertFrom + text.length),
  });
  view.focus();
}

function insertMarkdownBlock(view: EditorView, from: number, to: number, text: string) {
  const insertFrom = Math.min(from, view.state.doc.length);
  const insertTo = Math.min(Math.max(to, insertFrom), view.state.doc.length);
  const before = insertFrom > 0 ? view.state.doc.sliceString(Math.max(0, insertFrom - 2), insertFrom) : "";
  const after =
    insertTo < view.state.doc.length
      ? view.state.doc.sliceString(insertTo, Math.min(view.state.doc.length, insertTo + 2))
      : "";
  insertAt(view, insertFrom, insertTo, padMarkdownBlock(text, before, after));
}

function visibleLineAtOffset(view: EditorView, offset: number) {
  const y = view.scrollDOM.getBoundingClientRect().top + offset - view.documentTop;
  if (y <= 0) return 1;
  const lastBlock = view.lineBlockAt(view.state.doc.length);
  if (y >= lastBlock.top + lastBlock.height) return view.state.doc.lines + 1;
  const block = view.lineBlockAtHeight(y);
  const line = view.state.doc.lineAt(block.from);
  const progress = block.height > 0 ? (y - block.top) / block.height : 0;
  return line.number + clamp(progress, 0, 0.999);
}

function scrollViewToLine(view: EditorView, line: number, offset: number) {
  if (line <= 1) {
    view.scrollDOM.scrollTop = 0;
    return;
  }
  if (line >= view.state.doc.lines + 1) {
    view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
    return;
  }
  const lineNumber = clamp(Math.floor(line), 1, view.state.doc.lines);
  const fraction = clamp(line - lineNumber, 0, 0.999);
  const block = view.lineBlockAt(view.state.doc.line(lineNumber).from);
  const targetY = block.top + block.height * fraction;
  const currentY = view.scrollDOM.getBoundingClientRect().top + offset - view.documentTop;
  view.scrollDOM.scrollTop += targetY - currentY;
}

function createEditorExtensions(
  isDark: boolean,
  settings: AppSettings["editor"],
  onPasteImages?: (files: File[]) => Promise<string>,
) {
  return [
    history(),
    markdown(),
    ...(settings.lineWrapping ? [EditorView.lineWrapping] : []),
    ...(settings.lineNumbers ? [lineNumbers()] : []),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    EditorView.domEventHandlers({
      paste(event, view) {
        if (!onPasteImages) return false;
        const files = collectClipboardImages(event.clipboardData);
        if (!files.length) return false;
        event.preventDefault();
        const { from, to } = view.state.selection.main;
        void onPasteImages(files).then((markdown) => {
          if (markdown) insertMarkdownBlock(view, from, to, markdown);
        });
        return true;
      },
      drop(event, view) {
        if (!onPasteImages) return false;
        const files = collectClipboardImages(event.dataTransfer);
        if (!files.length) return false;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        const position = positionFromCoords(view, event.clientX, event.clientY);
        void onPasteImages(files).then((markdown) => {
          if (markdown) insertMarkdownBlock(view, position, position, markdown);
        });
        return true;
      },
      dragover(event) {
        if (!event.dataTransfer?.types.includes("Files")) return false;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        return true;
      },
      dragenter(event) {
        if (!event.dataTransfer?.types.includes("Files")) return false;
        event.preventDefault();
        return true;
      },
    }),
    EditorView.theme(
      {
        "&": {
          height: "100%",
          backgroundColor: "var(--memoir-canvas)",
          color: "var(--memoir-text)",
          fontSize: `${settings.fontSize}px`,
        },
        ".cm-scroller": {
          height: "100%",
          overflow: "auto",
          overflowAnchor: "none",
          overscrollBehavior: "contain",
          backgroundColor: "var(--memoir-canvas)",
          fontFamily: "var(--memoir-mono-font)",
        },
        ".cm-content": {
          minHeight: "100%",
          padding: "30px 34px 84px",
          backgroundColor: "var(--memoir-canvas)",
          color: "var(--memoir-text)",
          fontFamily: "var(--memoir-mono-font)",
          lineHeight: "1.82",
          caretColor: "var(--memoir-text)",
        },
        ".cm-line": {
          paddingLeft: "2px",
          paddingRight: "18px",
        },
        ".cm-gutters": {
          backgroundColor: "var(--memoir-canvas)",
          color: "color-mix(in srgb, var(--memoir-muted) 62%, transparent)",
          borderRight: "1px solid var(--memoir-border)",
        },
        ".cm-lineNumbers .cm-gutterElement": {
          minWidth: "34px",
          paddingLeft: "8px",
          paddingRight: "10px",
          fontSize: "10px",
        },
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor: "color-mix(in srgb, var(--memoir-panel) 46%, transparent)",
        },
        ".cm-focused": { outline: "none" },
        ".cm-cursor": { borderLeftColor: "var(--memoir-text)" },
        ".cm-selectionBackground, .cm-content ::selection": {
          backgroundColor: "var(--memoir-accent-soft) !important",
        },
      },
      { dark: isDark },
    ),
  ];
}

export interface EditorHandle {
  getScrollElement: () => HTMLElement | null;
  getVisibleLine: (offset?: number) => number | null;
  scrollToLine: (line: number, offset?: number) => void;
  insertSnippet: (before: string, after?: string, placeholder?: string) => void;
  insertText: (text: string) => void;
  insertTextAtCoords: (x: number, y: number, text: string) => void;
}

interface EditorPaneProps {
  content: string;
  settings: AppSettings;
  isDark: boolean;
  fileName: string;
  onChange: (content: string) => void;
  onScroll?: () => void;
  onPasteImages?: (files: File[]) => Promise<string>;
  highlightDrop?: boolean;
}

export const EditorPane = forwardRef<EditorHandle, EditorPaneProps>(function EditorPane(
  {
    content,
    settings,
    isDark,
    fileName,
    onChange,
    onScroll,
    onPasteImages,
    highlightDrop = false,
  },
  forwardedRef,
) {
  const { t, tc } = useI18n();
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [htmlDropActive, setHtmlDropActive] = useState(false);
  const dropDepthRef = useRef(0);
  const onScrollRef = useRef(onScroll);
  const detachScrollRef = useRef<(() => void) | null>(null);
  onScrollRef.current = onScroll;
  const extensions = useMemo(
    () => createEditorExtensions(isDark, settings.editor, onPasteImages),
    [isDark, onPasteImages, settings.editor],
  );
  const parsed = useMemo(() => parseNote(content, fileName), [content, fileName]);
  const stats = useMemo(() => noteStats(content), [content]);

  useEffect(() => () => detachScrollRef.current?.(), []);

  useImperativeHandle(
    forwardedRef,
    () => ({
      getScrollElement: () => editorRef.current?.view?.scrollDOM || null,
      getVisibleLine: (offset = 0) => {
        const view = editorRef.current?.view;
        return view ? visibleLineAtOffset(view, offset) : null;
      },
      scrollToLine: (line, offset = 0) => {
        const view = editorRef.current?.view;
        if (view) scrollViewToLine(view, line, offset);
      },
      insertSnippet: (before, after = "", placeholder = "") => {
        const view = editorRef.current?.view;
        if (!view) return;
        const selection = view.state.selection.main;
        const selected = view.state.sliceDoc(selection.from, selection.to);
        const value = selected || placeholder;
        const replacement = `${before}${value}${after}`;
        insertAt(view, selection.from, selection.to, replacement);
        view.dispatch({
          selection: EditorSelection.cursor(selection.from + before.length + value.length),
        });
        view.focus();
      },
      insertText: (text) => {
        const view = editorRef.current?.view;
        if (!view || !text) return;
        const selection = view.state.selection.main;
        insertMarkdownBlock(view, selection.from, selection.to, text);
      },
      insertTextAtCoords: (x, y, text) => {
        const view = editorRef.current?.view;
        if (!view || !text) return;
        const position = positionFromCoords(view, x, y);
        insertMarkdownBlock(view, position, position, text);
      },
    }),
    [],
  );

  const showDrop = highlightDrop || htmlDropActive;

  return (
    <section
      aria-label={t("editor.markdownEditor")}
      className={cn(
        "editor-pane relative min-h-0 min-w-0 overflow-hidden border-r border-border bg-canvas max-[760px]:min-h-[calc(100vh-138px)] max-[760px]:border-r-0",
        showDrop && "is-file-drop",
      )}
      onDragEnter={(event) => {
        if (!event.dataTransfer?.types.includes("Files")) return;
        dropDepthRef.current += 1;
        setHtmlDropActive(true);
      }}
      onDragLeave={() => {
        dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
        if (dropDepthRef.current === 0) setHtmlDropActive(false);
      }}
      onDrop={() => {
        dropDepthRef.current = 0;
        setHtmlDropActive(false);
      }}
    >
      <CodeMirror
        basicSetup={false}
        className="h-full"
        extensions={extensions}
        height="100%"
        onChange={onChange}
        onCreateEditor={(view) => {
          detachScrollRef.current?.();
          const handleScroll = () => onScrollRef.current?.();
          view.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });
          detachScrollRef.current = () => view.scrollDOM.removeEventListener("scroll", handleScroll);
          handleScroll();
        }}
        ref={editorRef}
        value={content}
      />
      {showDrop && (
        <div className="editor-drop-overlay" role="status">
          {t("editor.dropImages")}
        </div>
      )}
      <footer className="editor-statusbar absolute inset-x-0 bottom-0 flex h-7 items-center gap-3 border-t border-border bg-elevated/80 px-4 text-[9px] text-muted backdrop-blur-md">
        <span>{tc("editor.words", stats.words)}</span>
        <span>{tc("editor.chars", stats.chars)}</span>
        <span>{tc("editor.minutes", stats.minutes)}</span>
        {parsed.tags.slice(0, 3).map((tag) => (
          <Tag key={tag}>#{tag}</Tag>
        ))}
      </footer>
    </section>
  );
});

export default EditorPane;
