import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { EditorSelection } from "@codemirror/state";
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { tags as highlightTags } from "@lezer/highlight";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type MutableRefObject } from "react";
import { fencedCodeBlockHighlighter, fencedCodeLanguages } from "./code-languages";
import { clamp } from "./scroll-sync";
import { collectClipboardImages, padMarkdownBlock } from "../../domain/attachments";
import { writeClipboardText } from "./clipboard";
import type { EditorMenuTarget } from "./EditorContextMenu";
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

function editorMenuTarget(view: EditorView, x: number, y: number): EditorMenuTarget {
  const selection = view.state.selection.main;
  return {
    x,
    y,
    hasSelection: !selection.empty,
    canUndo: undoDepth(view.state) > 0,
    canRedo: redoDepth(view.state) > 0,
  };
}

function selectEntireDocument(view: EditorView) {
  view.focus();
  view.dispatch({
    selection: EditorSelection.create([EditorSelection.range(0, view.state.doc.length)]),
    userEvent: "select",
  });
  const root = view.contentDOM;
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  try {
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(root);
    selection.removeAllRanges();
    selection.addRange(range);
  } catch {
    // Some webviews reject range updates while a menu is closing.
  }
}

function ignoreEditorPointer(event: Event, until: MutableRefObject<number>) {
  if (performance.now() < until.current) {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  return false;
}

const markdownHighlightStyle = HighlightStyle.define([
  { tag: highlightTags.heading1, class: "cm-md-heading cm-md-h1" },
  { tag: highlightTags.heading2, class: "cm-md-heading cm-md-h2" },
  { tag: highlightTags.heading3, class: "cm-md-heading cm-md-h3" },
  { tag: highlightTags.heading4, class: "cm-md-heading cm-md-h4" },
  { tag: highlightTags.heading5, class: "cm-md-heading cm-md-h5" },
  { tag: highlightTags.heading6, class: "cm-md-heading cm-md-h6" },
  { tag: highlightTags.processingInstruction, class: "cm-md-mark" },
  { tag: highlightTags.atom, class: "cm-md-task" },
  { tag: highlightTags.emphasis, class: "cm-md-emphasis" },
  { tag: highlightTags.strong, class: "cm-md-strong" },
  { tag: highlightTags.strikethrough, class: "cm-md-strikethrough" },
  { tag: highlightTags.link, class: "cm-md-link" },
  { tag: highlightTags.url, class: "cm-md-url" },
  { tag: highlightTags.monospace, class: "cm-md-code" },
  { tag: highlightTags.quote, class: "cm-md-quote" },
  { tag: highlightTags.contentSeparator, class: "cm-md-hr" },
  { tag: highlightTags.comment, class: "cm-md-comment" },
  { tag: highlightTags.lineComment, class: "cm-md-comment" },
  { tag: highlightTags.blockComment, class: "cm-md-comment" },
  { tag: highlightTags.labelName, class: "cm-md-label" },
  { tag: highlightTags.string, class: "cm-md-string" },
  { tag: highlightTags.keyword, class: "cm-code-keyword" },
  { tag: highlightTags.controlKeyword, class: "cm-code-keyword" },
  { tag: highlightTags.definitionKeyword, class: "cm-code-keyword" },
  { tag: highlightTags.moduleKeyword, class: "cm-code-keyword" },
  { tag: highlightTags.bool, class: "cm-code-bool" },
  { tag: highlightTags.number, class: "cm-code-number" },
  { tag: highlightTags.literal, class: "cm-code-number" },
  { tag: highlightTags.regexp, class: "cm-code-regexp" },
  { tag: highlightTags.typeName, class: "cm-code-type" },
  { tag: highlightTags.className, class: "cm-code-type" },
  { tag: highlightTags.function(highlightTags.variableName), class: "cm-code-fn" },
  { tag: highlightTags.function(highlightTags.propertyName), class: "cm-code-fn" },
  { tag: highlightTags.definition(highlightTags.variableName), class: "cm-code-def" },
  { tag: highlightTags.propertyName, class: "cm-code-prop" },
  { tag: highlightTags.variableName, class: "cm-code-name" },
  { tag: highlightTags.operator, class: "cm-code-operator" },
  { tag: highlightTags.invalid, class: "cm-code-invalid" },
]);

function createEditorExtensions(
  isDark: boolean,
  settings: AppSettings["editor"],
  onPasteImages?: (files: File[]) => Promise<string>,
  onContextMenu?: (target: EditorMenuTarget) => void,
  ignorePointerUntil?: MutableRefObject<number>,
) {
  return [
    history(),
    markdown({ codeLanguages: fencedCodeLanguages }),
    syntaxHighlighting(markdownHighlightStyle),
    fencedCodeBlockHighlighter(),
    highlightActiveLine(),
    ...(settings.lineWrapping ? [EditorView.lineWrapping] : []),
    ...(settings.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    EditorView.domEventHandlers({
      mousedown(event) {
        return ignorePointerUntil ? ignoreEditorPointer(event, ignorePointerUntil) : false;
      },
      pointerdown(event) {
        return ignorePointerUntil ? ignoreEditorPointer(event, ignorePointerUntil) : false;
      },
      click(event) {
        return ignorePointerUntil ? ignoreEditorPointer(event, ignorePointerUntil) : false;
      },
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
      contextmenu(event, view) {
        event.preventDefault();
        const selection = view.state.selection.main;
        if (selection.empty) {
          const pos = positionFromCoords(view, event.clientX, event.clientY);
          if (pos !== selection.from) {
            view.dispatch({ selection: EditorSelection.cursor(pos) });
          }
        }
        onContextMenu?.(editorMenuTarget(view, event.clientX, event.clientY));
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
          fontFamily: "inherit",
        },
        ".cm-content": {
          minHeight: "100%",
          padding: "12px 16px 48px",
          backgroundColor: "transparent",
          color: "var(--memoir-text)",
          fontFamily: "inherit",
          lineHeight: "1.7",
          caretColor: "var(--memoir-text)",
        },
        ".cm-line": {
          paddingLeft: "0",
          paddingRight: "8px",
        },
        ".cm-gutters": {
          backgroundColor: "var(--memoir-canvas)",
          color: "color-mix(in srgb, var(--memoir-muted) 72%, transparent)",
          borderRight: "1px solid color-mix(in srgb, var(--memoir-border) 70%, transparent)",
        },
        ".cm-lineNumbers .cm-gutterElement": {
          minWidth: "34px",
          paddingLeft: "8px",
          paddingRight: "10px",
          fontSize: "10px",
        },
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor: "color-mix(in srgb, var(--memoir-text) 4%, transparent)",
        },
        ".cm-focused": { outline: "none" },
        ".cm-cursor, .cm-dropCursor": {
          borderLeftColor: "var(--memoir-text)",
          borderLeftWidth: "1.5px",
        },
        ".cm-content ::selection": {
          backgroundColor: "color-mix(in srgb, var(--memoir-accent) 32%, transparent) !important",
        },
        ".cm-selectionBackground": {
          backgroundColor: "color-mix(in srgb, var(--memoir-accent) 32%, transparent) !important",
        },
        "&.cm-focused .cm-selectionBackground": {
          backgroundColor: "color-mix(in srgb, var(--memoir-accent) 32%, transparent) !important",
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
  insertRaw: (text: string) => void;
  undo: () => void;
  redo: () => void;
  selectAll: () => void;
  getSelectedText: () => string;
  cut: () => Promise<void>;
  copy: () => Promise<void>;
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
  onContextMenu?: (target: EditorMenuTarget) => void;
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
    onContextMenu,
  },
  forwardedRef,
) {
  const { t, tc } = useI18n();
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const [htmlDropActive, setHtmlDropActive] = useState(false);
  const dropDepthRef = useRef(0);
  const ignorePointerUntil = useRef(0);
  const onScrollRef = useRef(onScroll);
  const detachScrollRef = useRef<(() => void) | null>(null);
  onScrollRef.current = onScroll;
  const extensions = useMemo(
    () =>
      createEditorExtensions(
        isDark,
        settings.editor,
        onPasteImages,
        onContextMenu,
        ignorePointerUntil,
      ),
    [isDark, onContextMenu, onPasteImages, settings.editor],
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
      insertRaw: (text) => {
        const view = editorRef.current?.view;
        if (!view || !text) return;
        const selection = view.state.selection.main;
        insertAt(view, selection.from, selection.to, text);
      },
      undo: () => {
        const view = editorRef.current?.view;
        if (view) undo(view);
      },
      redo: () => {
        const view = editorRef.current?.view;
        if (view) redo(view);
      },
      selectAll: () => {
        const view = editorRef.current?.view;
        if (!view) return;
        ignorePointerUntil.current = performance.now() + 500;
        selectEntireDocument(view);
      },
      getSelectedText: () => {
        const view = editorRef.current?.view;
        if (!view) return "";
        const selection = view.state.selection.main;
        return view.state.sliceDoc(selection.from, selection.to);
      },
      cut: async () => {
        const view = editorRef.current?.view;
        if (!view) return;
        const selection = view.state.selection.main;
        if (selection.empty) return;
        await writeClipboardText(view.state.sliceDoc(selection.from, selection.to));
        insertAt(view, selection.from, selection.to, "");
      },
      copy: async () => {
        const view = editorRef.current?.view;
        if (!view) return;
        const selection = view.state.selection.main;
        if (selection.empty) return;
        await writeClipboardText(view.state.sliceDoc(selection.from, selection.to));
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
