import * as stylex from "@stylexjs/stylex";
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
import { search, searchKeymap } from "@codemirror/search";
import { EditorSelection } from "@codemirror/state";
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { tags as highlightTags } from "@lezer/highlight";
import { forwardRef, useDeferredValue, useEffect, useImperativeHandle, useMemo, useRef, useState, type MutableRefObject } from "react";
import { bindLiveEditor } from "../../domain/live-editor";
import { fencedCodeBlockHighlighter, fencedCodeLanguages } from "./code-languages";
import { CodeMirrorHost, type CodeMirrorHostHandle } from "./code-mirror-host";
import { clamp } from "./scroll-sync";
import { collectClipboardImages, padMarkdownBlock } from "../../domain/attachments";
import { writeClipboardText } from "./clipboard";
import type { EditorMenuTarget } from "./EditorContextMenu";
import type { AppLocale, AppSettings } from "../../domain/settings";
import { useI18n } from "../../i18n/react";
import { createMemoirSearchPanel, searchPanelLabels } from "./search-panel";
import { noteStats } from "../library/note-utils";
import { Tag } from "../../components/ui";
import { accents, colors, typography } from "../../styles/tokens.stylex";
import { editorStyles } from "./editor-styles.stylex";
import {
  wikiLinkExtensions,
  wikiNoteCatalog,
  wikiSourcePath,
  type WikiCatalogNote,
} from "./wiki-links";
import { formatMarkdownLines, type MarkdownLineFormat } from "./markdown-format";
import { LONG_NOTE_DEFER_THRESHOLD } from "./editor-performance";

export { EDITOR_SNAPSHOT_DEBOUNCE_MS } from "./code-mirror-host";

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
  settings: AppSettings,
  onPasteImages?: (files: File[]) => Promise<string>,
  onContextMenu?: (target: EditorMenuTarget) => void,
  ignorePointerUntil?: MutableRefObject<number>,
  wiki?: {
    catalog: WikiCatalogNote[];
    sourcePath: string;
    onOpenNote?: (path: string) => void;
  },
  locale: AppLocale = "zh",
) {
  const labels = searchPanelLabels(locale);
  return [
    history(),
    markdown({ codeLanguages: fencedCodeLanguages }),
    syntaxHighlighting(markdownHighlightStyle),
    fencedCodeBlockHighlighter(),
    highlightActiveLine(),
    wikiNoteCatalog.of(wiki?.catalog ?? []),
    wikiSourcePath.of(wiki?.sourcePath ?? ""),
    ...wikiLinkExtensions(wiki?.onOpenNote),
    ...(settings.editor.lineWrapping ? [EditorView.lineWrapping] : []),
    ...(settings.editor.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
    search({
      top: true,
      createPanel: createMemoirSearchPanel(labels),
    }),
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
          backgroundColor: colors.canvas,
          color: colors.text,
          fontSize: `${settings.editor.fontSize}px`,
          userSelect: "text",
          WebkitUserSelect: "text",
        },
        ".cm-scroller": {
          height: "100%",
          overflow: "auto",
          overflowAnchor: "none",
          overscrollBehavior: "contain",
          backgroundColor: colors.canvas,
          fontFamily: settings.appearance.bodyFont === "serif" ? typography.serifFont : typography.uiFont,
        },
        ".cm-content": {
          minHeight: "100%",
          padding: "12px 16px 48px",
          backgroundColor: "transparent",
          color: colors.text,
          fontFamily: "inherit",
          lineHeight: "1.7",
          caretColor: colors.text,
        },
        ".cm-line": {
          paddingLeft: "0",
          paddingRight: "8px",
        },
        ".cm-gutters": {
          backgroundColor: colors.canvas,
          color: `color-mix(in srgb, ${colors.muted} 72%, transparent)`,
          borderRight: `1px solid color-mix(in srgb, ${colors.border} 70%, transparent)`,
        },
        ".cm-lineNumbers .cm-gutterElement": {
          minWidth: "34px",
          paddingLeft: "8px",
          paddingRight: "10px",
          fontSize: "10px",
        },
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor: `color-mix(in srgb, ${colors.text} 4%, transparent)`,
        },
        ".cm-focused": { outline: "none" },
        ".cm-panels": {
          backgroundColor: `color-mix(in srgb, ${colors.elevated} 82%, ${colors.canvas})`,
          color: colors.text,
        },
        ".cm-panels-top": {
          borderBottom: `1px solid color-mix(in srgb, ${colors.border} 88%, transparent)`,
        },
        ".cm-searchMatch": {
          backgroundColor: `color-mix(in srgb, ${colors.codeNumber} 32%, transparent)`,
          borderRadius: "2px",
        },
        ".cm-searchMatch-selected": {
          backgroundColor: `color-mix(in srgb, ${colors.codeNumber} 52%, transparent)`,
        },
        ".cm-cursor, .cm-dropCursor": {
          borderLeftColor: colors.text,
          borderLeftWidth: "1.5px",
        },
        ".cm-content ::selection, .cm-line ::selection": {
          backgroundColor: `color-mix(in srgb, ${accents.primary} 32%, transparent) !important`,
        },
        ".cm-selectionBackground": {
          backgroundColor: `color-mix(in srgb, ${accents.primary} 32%, transparent) !important`,
        },
        "&.cm-focused .cm-selectionBackground": {
          backgroundColor: `color-mix(in srgb, ${accents.primary} 32%, transparent) !important`,
        },
        ".cm-wiki-link": {
          color: accents.primary,
          textDecoration: "underline dashed",
          textUnderlineOffset: "3px",
        },
        ".cm-md-heading": {
          color: colors.text,
          fontWeight: "730",
          letterSpacing: "0",
        },
        ".cm-line:has(.cm-md-h1)": {
          fontSize: "1.72em",
          lineHeight: "1.28",
        },
        ".cm-line:has(.cm-md-h2)": {
          fontSize: "1.36em",
          lineHeight: "1.32",
        },
        ".cm-line:has(.cm-md-h3)": {
          fontSize: "1.12em",
          lineHeight: "1.4",
        },
        ".cm-md-mark": {
          color: `color-mix(in srgb, ${colors.muted} 88%, transparent)`,
          fontWeight: "500",
        },
        ".cm-md-task": {
          color: `color-mix(in srgb, ${colors.muted} 70%, ${colors.text})`,
          fontWeight: "550",
          letterSpacing: "0",
        },
        ".cm-md-emphasis": { fontStyle: "italic" },
        ".cm-md-strong": { fontWeight: "700" },
        ".cm-md-strikethrough": {
          color: colors.muted,
          textDecoration: "line-through",
        },
        ".cm-md-link": { color: accents.primary },
        ".cm-md-url, .cm-md-label": {
          color: `color-mix(in srgb, ${accents.primary} 58%, ${colors.muted})`,
        },
        ".cm-md-string, .cm-code-regexp": { color: colors.codeString },
        ".cm-md-code": {
          borderRadius: "4px",
          backgroundColor: `color-mix(in srgb, ${colors.panel} 88%, transparent)`,
          padding: "0.08em 0.28em",
          color: `color-mix(in srgb, ${colors.text} 88%, ${colors.muted})`,
          fontFamily: typography.monoFont,
          fontSize: "0.9em",
        },
        ".cm-md-codeblock": {
          backgroundColor: `color-mix(in srgb, ${colors.panel} 70%, transparent)`,
          fontFamily: typography.monoFont,
        },
        ".cm-md-codeblock .cm-md-code": {
          backgroundColor: "transparent",
          padding: "0",
          fontSize: "inherit",
        },
        ".cm-code-keyword, .cm-code-bool": { color: colors.codeKeyword },
        ".cm-code-number": { color: colors.codeNumber },
        ".cm-code-fn, .cm-code-def": { color: colors.codeFunction },
        ".cm-code-type": { color: colors.codeType },
        ".cm-code-prop": { color: colors.codeProperty },
        ".cm-code-name, .cm-code-operator": {
          color: `color-mix(in srgb, ${colors.text} 88%, ${colors.muted})`,
        },
        ".cm-code-invalid": { color: colors.danger },
        ".cm-md-quote, .cm-md-hr": { color: colors.muted },
        ".cm-md-comment": { color: colors.muted, fontStyle: "italic" },
        "@media (max-width: 980px)": {
          ".cm-content": {
            paddingLeft: "16px !important",
            paddingRight: "16px !important",
          },
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
  formatLines: (format: MarkdownLineFormat, placeholder?: string) => void;
  undo: () => void;
  redo: () => void;
  selectAll: () => void;
  getSelectedText: () => string;
  getSelection: () => { from: number; to: number; text: string } | null;
  replaceRange: (from: number, to: number, text: string, expected: string) => boolean;
  cut: () => Promise<void>;
  copy: () => Promise<void>;
}

const EMPTY_WIKI_CATALOG: WikiCatalogNote[] = [];

interface EditorPaneProps {
  content: string;
  settings: AppSettings;
  isDark: boolean;
  fileName: string;
  onChange: (content: string) => void;
  onScroll?: () => void;
  onScrollIntent?: () => void;
  onPasteImages?: (files: File[]) => Promise<string>;
  highlightDrop?: boolean;
  onContextMenu?: (target: EditorMenuTarget) => void;
  wikiCatalog?: WikiCatalogNote[];
  sourcePath?: string;
  onOpenNote?: (path: string) => void;
  tags?: string[];
}

export const EditorPane = forwardRef<EditorHandle, EditorPaneProps>(function EditorPane(
  {
    content,
    settings,
    isDark,
    onChange,
    onScroll,
    onScrollIntent,
    onPasteImages,
    highlightDrop = false,
    onContextMenu,
    wikiCatalog = EMPTY_WIKI_CATALOG,
    sourcePath = "",
    onOpenNote,
    tags = [],
  },
  forwardedRef,
) {
  const { t, tc, locale } = useI18n();
  const hostRef = useRef<CodeMirrorHostHandle>(null);
  const [htmlDropActive, setHtmlDropActive] = useState(false);
  const dropDepthRef = useRef(0);
  const ignorePointerUntil = useRef(0);
  const onScrollRef = useRef(onScroll);
  const onScrollIntentRef = useRef(onScrollIntent);
  const detachScrollRef = useRef<(() => void) | null>(null);
  const callbacksRef = useRef({ onPasteImages, onContextMenu, onOpenNote });
  callbacksRef.current = { onPasteImages, onContextMenu, onOpenNote };
  onScrollRef.current = onScroll;
  onScrollIntentRef.current = onScrollIntent;
  const extensions = useMemo(
    () =>
      createEditorExtensions(
        isDark,
        settings,
        callbacksRef.current.onPasteImages
          ? (files) => callbacksRef.current.onPasteImages?.(files) ?? Promise.resolve("")
          : undefined,
        (target) => callbacksRef.current.onContextMenu?.(target),
        ignorePointerUntil,
        {
          catalog: wikiCatalog,
          sourcePath,
          onOpenNote: (path) => callbacksRef.current.onOpenNote?.(path),
        },
        locale,
      ),
    [isDark, locale, settings, sourcePath, wikiCatalog],
  );
  const statsContent = useDeferredValue(
    content,
    content.length >= LONG_NOTE_DEFER_THRESHOLD ? "" : content,
  );
  const stats = useMemo(() => noteStats(statsContent), [statsContent]);

  useEffect(() => () => detachScrollRef.current?.(), []);

  useEffect(() => {
    if (!sourcePath) return;
    return bindLiveEditor(sourcePath, () => hostRef.current?.flush() ?? "");
  }, [sourcePath]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      getScrollElement: () => hostRef.current?.getView()?.scrollDOM || null,
      getVisibleLine: (offset = 0) => {
        const view = hostRef.current?.getView();
        return view ? visibleLineAtOffset(view, offset) : null;
      },
      scrollToLine: (line, offset = 0) => {
        const view = hostRef.current?.getView();
        if (view) scrollViewToLine(view, line, offset);
      },
      insertSnippet: (before, after = "", placeholder = "") => {
        const view = hostRef.current?.getView();
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
        const view = hostRef.current?.getView();
        if (!view || !text) return;
        const selection = view.state.selection.main;
        insertMarkdownBlock(view, selection.from, selection.to, text);
      },
      insertTextAtCoords: (x, y, text) => {
        const view = hostRef.current?.getView();
        if (!view || !text) return;
        const position = positionFromCoords(view, x, y);
        insertMarkdownBlock(view, position, position, text);
      },
      insertRaw: (text) => {
        const view = hostRef.current?.getView();
        if (!view || !text) return;
        const selection = view.state.selection.main;
        insertAt(view, selection.from, selection.to, text);
      },
      formatLines: (format, placeholder = "") => {
        const view = hostRef.current?.getView();
        if (!view) return;
        const selection = view.state.selection.main;
        const edit = formatMarkdownLines(
          view.state.doc.toString(),
          selection.from,
          selection.to,
          format,
          placeholder,
        );
        view.dispatch({
          changes: { from: edit.from, to: edit.to, insert: edit.insert },
          selection: EditorSelection.range(edit.selectionFrom, edit.selectionTo),
        });
        view.focus();
      },
      undo: () => {
        const view = hostRef.current?.getView();
        if (view) undo(view);
      },
      redo: () => {
        const view = hostRef.current?.getView();
        if (view) redo(view);
      },
      selectAll: () => {
        const view = hostRef.current?.getView();
        if (!view) return;
        ignorePointerUntil.current = performance.now() + 500;
        selectEntireDocument(view);
      },
      getSelectedText: () => {
        const view = hostRef.current?.getView();
        if (!view) return "";
        const selection = view.state.selection.main;
        return view.state.sliceDoc(selection.from, selection.to);
      },
      getSelection: () => {
        const view = hostRef.current?.getView();
        if (!view) return null;
        const selection = view.state.selection.main;
        return {
          from: selection.from,
          to: selection.to,
          text: view.state.sliceDoc(selection.from, selection.to),
        };
      },
      replaceRange: (from, to, text, expected) => {
        const view = hostRef.current?.getView();
        if (!view || from < 0 || to < from || to > view.state.doc.length) return false;
        if (view.state.sliceDoc(from, to) !== expected) return false;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: EditorSelection.range(from, from + text.length),
          userEvent: "input.ai",
        });
        view.focus();
        return true;
      },
      cut: async () => {
        const view = hostRef.current?.getView();
        if (!view) return;
        const selection = view.state.selection.main;
        if (selection.empty) return;
        await writeClipboardText(view.state.sliceDoc(selection.from, selection.to));
        insertAt(view, selection.from, selection.to, "");
      },
      copy: async () => {
        const view = hostRef.current?.getView();
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
      data-editor-pane=""
      {...stylex.props(editorStyles.pane, showDrop && editorStyles.paneDropActive)}
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
      onKeyDownCapture={onScrollIntent}
      onPointerDownCapture={onScrollIntent}
      onTouchStartCapture={onScrollIntent}
      onWheelCapture={onScrollIntent}
    >
      <CodeMirrorHost
        doc={content}
        extensions={extensions}
        onChange={onChange}
        onCreateEditor={(view) => {
          detachScrollRef.current?.();
          const handleScroll = () => onScrollRef.current?.();
          const handleScrollIntent = () => onScrollIntentRef.current?.();
          view.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });
          view.scrollDOM.addEventListener("wheel", handleScrollIntent, { passive: true });
          view.scrollDOM.addEventListener("pointerdown", handleScrollIntent, { passive: true });
          view.scrollDOM.addEventListener("touchstart", handleScrollIntent, { passive: true });
          detachScrollRef.current = () => {
            view.scrollDOM.removeEventListener("scroll", handleScroll);
            view.scrollDOM.removeEventListener("wheel", handleScrollIntent);
            view.scrollDOM.removeEventListener("pointerdown", handleScrollIntent);
            view.scrollDOM.removeEventListener("touchstart", handleScrollIntent);
          };
          handleScroll();
        }}
        ref={hostRef}
      />
      {showDrop && (
        <div {...stylex.props(editorStyles.dropOverlay)} role="status">
          {t("editor.dropImages")}
        </div>
      )}
      <footer {...stylex.props(editorStyles.statusbar)}>
        <span>{tc("editor.words", stats.words)}</span>
        <span>{tc("editor.chars", stats.chars)}</span>
        <span>{tc("editor.minutes", stats.minutes)}</span>
        {tags.slice(0, 3).map((tag) => (
          <Tag key={tag}>#{tag}</Tag>
        ))}
      </footer>
    </section>
  );
});

export default EditorPane;
