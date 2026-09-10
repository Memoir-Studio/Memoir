import * as stylex from "@stylexjs/stylex";
import {
  Bold,
  BookOpen,
  Braces,
  ChevronDown,
  Code2,
  Ellipsis,
  ExternalLink,
  FileDown,
  FileCode2,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  LayoutPanelLeft,
  Link,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  LoaderCircle,
  MessageSquareQuote,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  Save,
  SplitSquareHorizontal,
  SquareSigma,
  Star,
  Strikethrough,
  Table2,
  Trash2,
  Undo2,
} from "lucide-react";
import { forwardRef, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  IconButton,
  SegmentedControl,
} from "../../components/ui";
import { fileDropTargetFromPoint, watchNativeFileDrop } from "../../platform/file-drop";
import { isTauriRuntime } from "../../platform/runtime";
import {
  DEFAULT_EDITOR_SPLIT,
  MAX_EDITOR_SPLIT,
  MIN_EDITOR_SPLIT,
} from "../../domain/layout";
import { LayoutResizeHandle } from "../layout/LayoutResizeHandle";
import { useAppStore } from "../../store/app-store";
import { useI18n } from "../../i18n/react";
import { stripFrontmatter } from "../library/note-utils";
import { handleWindowDragMouseDown } from "../window/window-drag";
import { markdownForAttachments } from "../../domain/attachments";
import { mapGatewayError } from "../../domain/errors";
import { revealWorkspaceItem } from "../workspace/workspace-utils";
import { readClipboardImageFiles, readClipboardText } from "./clipboard";
import { EditorContextMenu, type EditorMenuTarget } from "./EditorContextMenu";
import type { EditorHandle } from "./EditorPane";
import {
  bodySourceLineOffset,
  collectPreviewAnchors,
  countDocumentLines,
  lineForScrollTop,
  scrollTopForLine,
  syncViewportOffset,
  type ScrollAnchor,
} from "./scroll-sync";
import { exportNotePdf } from "../export/export-note-pdf";
import { useNoteGraph } from "../graph/useNoteGraph";
import { editorStyles } from "./editor-styles.stylex";
import type { MarkdownLineFormat } from "./markdown-format";

const EditorPane = lazy(() => import("./EditorPane"));
const PreviewPane = lazy(() => import("../preview/PreviewPane"));
type ScrollPane = "editor" | "preview";
type ProgrammaticScroll = { expiresAt: number; targetTop: number };

const PROGRAMMATIC_SCROLL_GUARD_MS = 800;
const PROGRAMMATIC_SCROLL_TOLERANCE_PX = 2;
const USER_SCROLL_INTENT_MS = 320;

function PaneFallback({ label }: { label: string }) {
  return <div {...stylex.props(editorStyles.fallback)}>{label}</div>;
}

export const EditorWorkspace = forwardRef<EditorHandle, {
  isDark: boolean;
  onRename: () => void;
  onDelete: () => void;
  style?: stylex.StyleXStyles;
}>(function EditorWorkspace(
  {
    isDark,
    onRename,
    onDelete,
    style,
  },
  forwardedRef,
) {
  const editorRef = useRef<EditorHandle>(null);
  const previewPaneRef = useRef<HTMLElement>(null);
  const programmaticScrollRef = useRef<Record<ScrollPane, ProgrammaticScroll | null>>({
    editor: null,
    preview: null,
  });
  const userScrollIntentRef = useRef<{ pane: ScrollPane; expiresAt: number } | null>(null);
  const lastScrollSourceRef = useRef<ScrollPane | null>(null);
  const pendingScrollRef = useRef<ScrollPane | null>(null);
  const scrollRafRef = useRef(0);
  const anchorCacheRef = useRef<{
    content: string;
    height: number;
    items: ScrollAnchor[];
  } | null>(null);
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const notes = useAppStore((state) => state.notes);
  const activePath = useAppStore((state) => state.activePath);
  const loadedContentPath = useAppStore((state) => state.loadedContentPath);
  const content = useAppStore((state) => state.content);
  const savedContent = useAppStore((state) => state.savedContent);
  const settings = useAppStore((state) => state.settings);
  const viewMode = useAppStore((state) => state.viewMode);
  const editorSplit = useAppStore((state) => state.layout.editorSplit);
  const setLayout = useAppStore((state) => state.setLayout);
  const isSaving = useAppStore((state) => state.isSaving);
  const isLoading = useAppStore((state) => state.isLoading);
  const setContent = useAppStore((state) => state.setContent);
  const handleEditorChange = useCallback(
    (text: string) => {
      if (useAppStore.getState().activePath !== activePath) return;
      setContent(text);
    },
    [activePath, setContent],
  );
  const selectNote = useAppStore((state) => state.selectNote);
  const setViewMode = useAppStore((state) => state.setViewMode);
  const saveActiveNote = useAppStore((state) => state.saveActiveNote);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite);
  const savePastedImages = useAppStore((state) => state.savePastedImages);
  const importDroppedImages = useAppStore((state) => state.importDroppedImages);
  const importAttachments = useAppStore((state) => state.importAttachments);
  const { t } = useI18n();
  const splitRef = useRef<HTMLDivElement>(null);
  const [splitWidth, setSplitWidth] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [nativeDropActive, setNativeDropActive] = useState(false);
  const [editorMenu, setEditorMenu] = useState<EditorMenuTarget | null>(null);
  const [headingMenu, setHeadingMenu] = useState<{ x: number; y: number } | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const { graph } = useNoteGraph();
  const untitled = t("editor.untitledFallback");
  const activeNote = notes.find((note) => note.relativePath === activePath) || null;
  const hasDocument = Boolean(activeNote && loadedContentPath === activePath);
  const lastLoadedNoteRef = useRef(activeNote);
  if (hasDocument) lastLoadedNoteRef.current = activeNote;
  const loadedNote =
    notes.find((note) => note.relativePath === loadedContentPath) ||
    (lastLoadedNoteRef.current?.relativePath === loadedContentPath
      ? lastLoadedNoteRef.current
      : null);
  const isOpeningNote = Boolean(
    isLoading && activePath && activePath !== loadedContentPath,
  );
  const isSwitchingNote = Boolean(isOpeningNote && loadedContentPath);
  const renderedNote = hasDocument ? activeNote : isSwitchingNote ? loadedNote : null;
  const hasRenderedDocument = Boolean(renderedNote && loadedContentPath);
  const body = useMemo(
    () => stripFrontmatter(hasRenderedDocument ? content : ""),
    [content, hasRenderedDocument],
  );
  const isDirty = hasDocument && content !== savedContent;

  useLayoutEffect(() => {
    if (viewMode !== "split" || !hasDocument) {
      setSplitWidth(0);
      return;
    }
    const split = splitRef.current;
    if (!split || typeof ResizeObserver === "undefined") return;
    const update = () => setSplitWidth(split.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(split);
    return () => observer.disconnect();
  }, [hasDocument, viewMode]);

  const applyScrollTop = useCallback(
    (pane: ScrollPane, element: HTMLElement, nextTop: number) => {
      if (Math.abs(element.scrollTop - nextTop) < 1) return;
      const guard: ProgrammaticScroll = {
        expiresAt: performance.now() + PROGRAMMATIC_SCROLL_GUARD_MS,
        targetTop: nextTop,
      };
      programmaticScrollRef.current[pane] = guard;
      element.scrollTop = nextTop;
    },
    [],
  );

  const consumeProgrammaticScroll = useCallback((source: ScrollPane) => {
    const now = performance.now();
    const intent = userScrollIntentRef.current;
    if (intent && intent.expiresAt < now) userScrollIntentRef.current = null;
    if (intent?.pane === source && intent.expiresAt >= now) {
      programmaticScrollRef.current[source] = null;
      intent.expiresAt = now + USER_SCROLL_INTENT_MS;
      return false;
    }
    const guard = programmaticScrollRef.current[source];
    if (!guard) return false;
    const scroller =
      source === "editor"
        ? editorRef.current?.getScrollElement()
        : previewPaneRef.current;
    const reachedTarget =
      scroller &&
      Math.abs(scroller.scrollTop - guard.targetTop) <= PROGRAMMATIC_SCROLL_TOLERANCE_PX;
    if (guard.expiresAt >= now && reachedTarget) {
      return true;
    }
    programmaticScrollRef.current[source] = null;
    return false;
  }, []);

  const markScrollIntent = useCallback((source: ScrollPane) => {
    userScrollIntentRef.current = {
      pane: source,
      expiresAt: performance.now() + USER_SCROLL_INTENT_MS,
    };
    programmaticScrollRef.current[source] = null;
    lastScrollSourceRef.current = source;
  }, []);

  const getPreviewAnchors = useCallback(() => {
    const previewScroller = previewPaneRef.current;
    if (!previewScroller) return [];
    const cached = anchorCacheRef.current;
    if (cached && cached.content === content && cached.height === previewScroller.scrollHeight) {
      return cached.items;
    }
    const items = collectPreviewAnchors(
      previewScroller,
      bodySourceLineOffset(content, body),
    );
    anchorCacheRef.current = {
      content,
      height: previewScroller.scrollHeight,
      items,
    };
    return items;
  }, [body, content]);

  const performScrollSync = useCallback(
    (source: ScrollPane) => {
      const editor = editorRef.current;
      const editorScroller = editor?.getScrollElement();
      const previewScroller = previewPaneRef.current;
      if (!editor || !editorScroller || !previewScroller) return;
      const lastLine = countDocumentLines(content);
      const anchors = getPreviewAnchors();
      const editorOffset = syncViewportOffset(editorScroller.clientHeight);
      const previewOffset = syncViewportOffset(previewScroller.clientHeight);
      lastScrollSourceRef.current = source;
      if (source === "editor") {
        const line = editor.getVisibleLine(editorOffset);
        if (line == null) return;
        applyScrollTop(
          "preview",
          previewScroller,
          scrollTopForLine(line, anchors, previewScroller, lastLine, previewOffset),
        );
        return;
      }
      const previousTop = editorScroller.scrollTop;
      const previousGuard = programmaticScrollRef.current.editor;
      editor.scrollToLine(
        lineForScrollTop(previewScroller.scrollTop, anchors, previewScroller, lastLine, previewOffset),
        editorOffset,
      );
      if (Math.abs(editorScroller.scrollTop - previousTop) < 1) {
        programmaticScrollRef.current.editor = previousGuard;
      } else {
        programmaticScrollRef.current.editor = {
          expiresAt: performance.now() + PROGRAMMATIC_SCROLL_GUARD_MS,
          targetTop: editorScroller.scrollTop,
        };
      }
    },
    [applyScrollTop, content, getPreviewAnchors],
  );

  const queueScrollSync = useCallback(
    (source: ScrollPane, replacePending = true) => {
      if (!replacePending && pendingScrollRef.current) return;
      pendingScrollRef.current = source;
      if (scrollRafRef.current) return;
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = 0;
        const pending = pendingScrollRef.current;
        pendingScrollRef.current = null;
        if (pending) performScrollSync(pending);
      });
    },
    [performScrollSync],
  );

  const beginScroll = useCallback(
    (source: ScrollPane) => {
      markScrollIntent(source);
      // Wheel and keyboard events run before the browser updates scrollTop.
      // Reading on the next frame also keeps sync alive if CodeMirror does not
      // emit a usable scroll event for that interaction.
      queueScrollSync(source);
    },
    [markScrollIntent, queueScrollSync],
  );

  const syncScroll = useCallback(
    (source: ScrollPane) => {
      if (consumeProgrammaticScroll(source)) return;
      lastScrollSourceRef.current = source;
      queueScrollSync(source);
    },
    [consumeProgrammaticScroll, queueScrollSync],
  );

  useEffect(() => {
    programmaticScrollRef.current.editor = null;
    programmaticScrollRef.current.preview = null;
    userScrollIntentRef.current = null;
    anchorCacheRef.current = null;
  }, [activePath]);

  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const previewObserverRef = useRef<ResizeObserver | null>(null);
  const previewMutationObserverRef = useRef<MutationObserver | null>(null);

  const attachPreviewArticle = useCallback(
    (node: HTMLElement | null) => {
      previewObserverRef.current?.disconnect();
      previewObserverRef.current = null;
      previewMutationObserverRef.current?.disconnect();
      previewMutationObserverRef.current = null;
      if (!node) return;
      const handlePreviewLayoutChange = () => {
        if (viewModeRef.current !== "split") return;
        anchorCacheRef.current = null;
        const intent = userScrollIntentRef.current;
        const previewOwnsScroll =
          pendingScrollRef.current === "preview" ||
          lastScrollSourceRef.current === "preview" ||
          (intent?.pane === "preview" && intent.expiresAt >= performance.now());
        if (previewOwnsScroll) return;
        queueScrollSync("editor", false);
      };
      const observer = new ResizeObserver(handlePreviewLayoutChange);
      observer.observe(node);
      previewObserverRef.current = observer;
      const mutationObserver = new MutationObserver(handlePreviewLayoutChange);
      mutationObserver.observe(node, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
      });
      previewMutationObserverRef.current = mutationObserver;
    },
    [queueScrollSync],
  );

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) window.cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = 0;
      pendingScrollRef.current = null;
      programmaticScrollRef.current.editor = null;
      programmaticScrollRef.current.preview = null;
      userScrollIntentRef.current = null;
      previewObserverRef.current?.disconnect();
      previewObserverRef.current = null;
      previewMutationObserverRef.current?.disconnect();
      previewMutationObserverRef.current = null;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void watchNativeFileDrop((event) => {
      if (event.type === "leave") {
        setNativeDropActive(false);
        return;
      }
      const overEditor = fileDropTargetFromPoint(event.x, event.y) === "editor";
      if (event.type === "hover") {
        setNativeDropActive(overEditor);
        return;
      }
      setNativeDropActive(false);
      if (!overEditor) return;
      void importDroppedImages(event.paths).then((markdown) => {
        if (markdown) editorRef.current?.insertTextAtCoords(event.x, event.y, markdown);
      });
    }).then((unlisten) => {
      if (disposed) unlisten();
      else stop = unlisten;
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, [importDroppedImages]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      getScrollElement: () => editorRef.current?.getScrollElement() ?? null,
      getVisibleLine: (offset) => editorRef.current?.getVisibleLine(offset) ?? null,
      scrollToLine: (line, offset) => editorRef.current?.scrollToLine(line, offset),
      insertSnippet: (before, after, placeholder) =>
        editorRef.current?.insertSnippet(before, after, placeholder),
      insertText: (text) => editorRef.current?.insertText(text),
      insertTextAtCoords: (x, y, text) => editorRef.current?.insertTextAtCoords(x, y, text),
      insertRaw: (text) => editorRef.current?.insertRaw(text),
      formatLines: (format, placeholder) => editorRef.current?.formatLines(format, placeholder),
      undo: () => editorRef.current?.undo(),
      redo: () => editorRef.current?.redo(),
      selectAll: () => editorRef.current?.selectAll(),
      getSelectedText: () => editorRef.current?.getSelectedText() ?? "",
      cut: () => editorRef.current?.cut() ?? Promise.resolve(),
      copy: () => editorRef.current?.copy() ?? Promise.resolve(),
    }),
    [],
  );

  const openEditorMenu = useCallback((target: EditorMenuTarget) => {
    setEditorMenu(target);
  }, []);

  const pasteIntoEditor = useCallback(async () => {
    const files = await readClipboardImageFiles();
    if (files.length) {
      const markdown = await savePastedImages(files);
      if (markdown) editorRef.current?.insertText(markdown);
      return;
    }
    const text = await readClipboardText();
    if (text) editorRef.current?.insertRaw(text);
  }, [savePastedImages]);

  const insertSnippet = useCallback(
    (before: string, after = "", placeholder = "") => {
      editorRef.current?.insertSnippet(before, after, placeholder);
    },
    [],
  );

  const formatLines = useCallback(
    (format: MarkdownLineFormat, placeholder = "") => {
      editorRef.current?.formatLines(format, placeholder);
    },
    [],
  );

  const exportActivePdf = useCallback(async () => {
    if (!activePath || isExporting) return;
    setIsExporting(true);
    try {
      await exportNotePdf(activePath);
    } finally {
      setIsExporting(false);
    }
  }, [activePath, isExporting]);

  const insertImportedImages = useCallback(async () => {
    const imported = await importAttachments();
    const markdown = markdownForAttachments(useAppStore.getState().activePath, imported);
    if (markdown) editorRef.current?.insertText(markdown);
  }, [importAttachments]);

  const toolbar = [
    { label: t("editor.undo"), icon: Undo2, action: () => editorRef.current?.undo() },
    { label: t("editor.redo"), icon: Redo2, action: () => editorRef.current?.redo() },
    { label: t("toolbar.bold"), icon: Bold, action: () => insertSnippet("**", "**", t("toolbar.placeholderText")), divider: true },
    { label: t("toolbar.italic"), icon: Italic, action: () => insertSnippet("_", "_", t("toolbar.placeholderText")) },
    { label: t("toolbar.strikethrough"), icon: Strikethrough, action: () => insertSnippet("~~", "~~", t("toolbar.placeholderText")) },
    { label: t("toolbar.inlineCode"), icon: Code2, action: () => insertSnippet("`", "`", t("toolbar.placeholderCode")) },
    { label: t("toolbar.link"), icon: Link, action: () => insertSnippet("[", "](https://)", t("toolbar.placeholderLink")) },
    { label: t("toolbar.wikiLink"), icon: Link2, action: () => insertSnippet("[[", "]]", t("toolbar.placeholderWikiLink")), divider: true },
    { label: t("toolbar.image"), icon: Image, action: () => void insertImportedImages() },
    { label: t("toolbar.quote"), icon: Quote, action: () => formatLines({ kind: "quote" }, t("toolbar.placeholderQuote")), divider: true },
    { label: t("toolbar.bulletList"), icon: List, action: () => formatLines({ kind: "bullet-list" }, t("toolbar.placeholderItem")) },
    { label: t("toolbar.orderedList"), icon: ListOrdered, action: () => formatLines({ kind: "ordered-list" }, t("toolbar.placeholderItem")) },
    { label: t("toolbar.taskList"), icon: ListTodo, action: () => formatLines({ kind: "task-list" }, t("toolbar.placeholderTask")) },
    { label: t("toolbar.codeBlock"), icon: FileCode2, action: () => insertSnippet("```\n", "\n```", t("toolbar.placeholderCode")), divider: true },
    { label: t("toolbar.table"), icon: Table2, action: () => editorRef.current?.insertText(t("toolbar.tableTemplate")) },
  ];

  return (
    <section data-editor-workspace="" {...stylex.props(editorStyles.workspace, style)}>
      <header
        {...stylex.props(editorStyles.header)}
        data-tauri-drag-region={isTauriRuntime() ? "" : undefined}
        onMouseDown={handleWindowDragMouseDown}
      >
        <div {...stylex.props(editorStyles.minWidth)}>
          <h2 {...stylex.props(editorStyles.title)}>
            {hasDocument ? activeNote?.title || untitled : t("editor.noNoteTitle")}
          </h2>
          <p {...stylex.props(editorStyles.subtitle)}>
            {hasDocument ? activePath : t("editor.noNoteSubtitle")}
          </p>
        </div>
        <div {...stylex.props(editorStyles.headerActions)}>
          <span
            aria-label={isSaving ? t("editor.saving") : isDirty ? t("editor.unsaved") : t("editor.saved")}
            aria-live="polite"
            data-state={isSaving ? "saving" : isDirty ? "dirty" : "saved"}
            role="status"
            title={isSaving ? t("editor.saving") : isDirty ? t("editor.unsaved") : t("editor.saved")}
            {...stylex.props(
              editorStyles.saveDot,
              isSaving ? editorStyles.saveDotSaving : isDirty && editorStyles.saveDotDirty,
            )}
          />
          <SegmentedControl
            display="icon"
            label={t("settings.defaultView")}
            onChange={setViewMode}
            options={[
              { value: "edit", label: t("editor.edit"), icon: <BookOpen size={14} /> },
              { value: "split", label: t("editor.split"), icon: <SplitSquareHorizontal size={14} /> },
              { value: "preview", label: t("editor.preview"), icon: <LayoutPanelLeft size={14} /> },
            ]}
            value={viewMode}
          />
          <IconButton active={activeNote?.favorite} label={t("editor.favorite")} onClick={() => void toggleFavorite()}>
            <Star {...stylex.props(editorStyles.favoriteIcon, activeNote?.favorite && editorStyles.favoriteIconActive)} />
          </IconButton>
          <IconButton disabled={!hasDocument} label={t("editor.save")} onClick={() => void saveActiveNote()}>
            <Save {...stylex.props(editorStyles.icon)} />
          </IconButton>
          <IconButton
            disabled={!hasDocument || isExporting}
            label={isExporting ? t("editor.exportingPdf") : t("editor.exportPdf")}
            onClick={() => void exportActivePdf()}
          >
            <FileDown {...stylex.props(editorStyles.icon)} />
          </IconButton>
          <IconButton
            label={t("editor.openInSystem")}
            onClick={() => {
              if (!workspaceRoot || !activePath) return;
              void revealWorkspaceItem(workspaceRoot, activePath).catch((error) => {
                useAppStore.setState({
                  error: t("errors.openInSystem", { message: mapGatewayError(error).message }),
                });
              });
            }}
            style={editorStyles.mobileHidden}
          >
            <ExternalLink {...stylex.props(editorStyles.icon)} />
          </IconButton>
          <IconButton style={editorStyles.mobileHidden} label={t("editor.rename")} onClick={() => onRename()}>
            <Braces {...stylex.props(editorStyles.icon)} />
          </IconButton>
          <IconButton style={editorStyles.mobileHidden} label={t("editor.delete")} onClick={() => onDelete()}>
            <Trash2 {...stylex.props(editorStyles.icon)} />
          </IconButton>
        </div>
      </header>
      <div
        aria-label={t("editor.toolbar")}
        role="toolbar"
        {...stylex.props(editorStyles.toolbar)}
      >
        <div {...stylex.props(editorStyles.toolbarGroup)}>
          <IconButton
            aria-expanded={Boolean(headingMenu)}
            aria-haspopup="menu"
            disabled={!hasDocument || viewMode === "preview"}
            label={t("toolbar.heading")}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setMoreMenu(null);
              setHeadingMenu({ x: rect.left, y: rect.bottom + 4 });
            }}
            style={[editorStyles.formatButton, editorStyles.formatMenuButton]}
          >
            <Heading2 {...stylex.props(editorStyles.iconSmall)} />
            <ChevronDown {...stylex.props(editorStyles.chevronIcon)} />
          </IconButton>
        </div>
        {toolbar.map(({ label, icon: Icon, action, divider }) => (
          <div {...stylex.props(editorStyles.toolbarGroup, divider && editorStyles.toolbarDivider)} key={label}>
            <IconButton disabled={!hasDocument || viewMode === "preview"} style={editorStyles.formatButton} label={label} onClick={action}>
              <Icon {...stylex.props(editorStyles.iconSmall)} />
            </IconButton>
          </div>
        ))}
        <div {...stylex.props(editorStyles.toolbarGroup, editorStyles.toolbarDivider)}>
          <IconButton
            aria-expanded={Boolean(moreMenu)}
            aria-haspopup="menu"
            disabled={!hasDocument || viewMode === "preview"}
            label={t("toolbar.more")}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              setHeadingMenu(null);
              setMoreMenu({ x: rect.right, y: rect.bottom + 4 });
            }}
            style={editorStyles.formatButton}
          >
            <Ellipsis {...stylex.props(editorStyles.iconSmall)} />
          </IconButton>
        </div>
      </div>

      <ContextMenu
        label={t("toolbar.heading")}
        onClose={() => setHeadingMenu(null)}
        open={Boolean(headingMenu)}
        x={headingMenu?.x ?? 0}
        y={headingMenu?.y ?? 0}
      >
        <ContextMenuItem icon={<Pilcrow />} label={t("toolbar.paragraph")} onSelect={() => formatLines({ kind: "heading", level: 0 })} />
        <ContextMenuSeparator />
        {([1, 2, 3, 4, 5, 6] as const).map((level) => (
          <ContextMenuItem
            icon={level === 1 ? <Heading1 /> : level === 2 ? <Heading2 /> : level === 3 ? <Heading3 /> : undefined}
            key={level}
            label={t("toolbar.headingLevel", { level })}
            onSelect={() => formatLines({ kind: "heading", level }, t("toolbar.placeholderHeading"))}
          />
        ))}
      </ContextMenu>
      <ContextMenu
        label={t("toolbar.more")}
        onClose={() => setMoreMenu(null)}
        open={Boolean(moreMenu)}
        x={moreMenu?.x ?? 0}
        y={moreMenu?.y ?? 0}
      >
        <ContextMenuItem icon={<SquareSigma />} label={t("toolbar.mathBlock")} onSelect={() => insertSnippet("$$\n", "\n$$", t("toolbar.placeholderFormula"))} />
        <ContextMenuItem icon={<MessageSquareQuote />} label={t("toolbar.callout")} onSelect={() => insertSnippet(`<Callout type="tip" title="${t("toolbar.placeholderCalloutTitle")}">\n`, "\n</Callout>", t("toolbar.placeholderCalloutBody"))} />
        <ContextMenuSeparator />
        <ContextMenuItem icon={<Minus />} label={t("toolbar.rule")} onSelect={() => editorRef.current?.insertText("---")} />
      </ContextMenu>

      {!hasRenderedDocument ? (
        <div {...stylex.props(editorStyles.empty)}>
          {isOpeningNote ? (
            <div aria-live="polite" role="status">
              <LoaderCircle {...stylex.props(editorStyles.emptyLoadingIcon)} />
              <p {...stylex.props(editorStyles.emptyBody)}>{t("editor.loadingNote")}</p>
            </div>
          ) : (
            <div>
              <h2 {...stylex.props(editorStyles.emptyTitle)}>{t("editor.emptyTitle")}</h2>
              <p {...stylex.props(editorStyles.emptyBody)}>{t("editor.emptyBody")}</p>
            </div>
          )}
        </div>
      ) : (
        <div
          aria-busy={isSwitchingNote}
          data-switching-note={isSwitchingNote ? "" : undefined}
          ref={splitRef}
          {...stylex.props(
            editorStyles.content,
            viewMode === "split" ? editorStyles.splitPane(editorSplit) : editorStyles.singlePane,
          )}
        >
          {viewMode !== "preview" && (
            <div inert={isSwitchingNote} {...stylex.props(editorStyles.paneContainer)}>
              <Suspense fallback={<PaneFallback label={t("editor.loadingEditor")} />}>
                <EditorPane
                  content={content}
                  fileName={renderedNote?.fileName || untitled}
                  isDark={isDark}
                  key={loadedContentPath || ""}
                  onChange={handleEditorChange}
                  highlightDrop={nativeDropActive}
                  onContextMenu={openEditorMenu}
                  onOpenNote={(path) => void selectNote(path)}
                  onPasteImages={savePastedImages}
                  onScroll={() => syncScroll("editor")}
                  onScrollIntent={() => beginScroll("editor")}
                  ref={editorRef}
                  settings={settings}
                  sourcePath={loadedContentPath || ""}
                  tags={renderedNote?.tags}
                  wikiCatalog={graph.nodes}
                />
              </Suspense>
              {viewMode === "split" && (
                <LayoutResizeHandle
                  defaultValue={splitWidth * DEFAULT_EDITOR_SPLIT}
                  disabled={splitWidth <= 0}
                  label={t("layout.resizeEditor")}
                  max={splitWidth * MAX_EDITOR_SPLIT}
                  min={splitWidth * MIN_EDITOR_SPLIT}
                  onChange={(editorPx) => {
                    if (splitWidth <= 0) return;
                    setLayout({ editorSplit: editorPx / splitWidth });
                  }}
                  value={splitWidth * editorSplit}
                />
              )}
            </div>
          )}
          {viewMode !== "edit" && (
            <div inert={isSwitchingNote} {...stylex.props(editorStyles.paneContainer)}>
              <Suspense fallback={<PaneFallback label={t("editor.loadingPreview")} />}>
                <PreviewPane
                  activePath={loadedContentPath}
                  articleRef={attachPreviewArticle}
                  body={body}
                  content={content}
                  note={renderedNote}
                  onContentChange={setContent}
                  onScroll={() => syncScroll("preview")}
                  onScrollIntent={() => beginScroll("preview")}
                  paneRef={previewPaneRef}
                  root={workspaceRoot}
                />
              </Suspense>
            </div>
          )}
          {isSwitchingNote && (
            <div aria-live="polite" role="status" {...stylex.props(editorStyles.noteLoadingOverlay)}>
              <span {...stylex.props(editorStyles.noteLoadingPill)}>
                <LoaderCircle {...stylex.props(editorStyles.noteLoadingIcon)} />
                {t("editor.loadingNote")}
              </span>
            </div>
          )}
        </div>
      )}
      <EditorContextMenu
        onClose={() => setEditorMenu(null)}
        onCopy={() => void editorRef.current?.copy()}
        onCut={() => void editorRef.current?.cut()}
        onPaste={() => void pasteIntoEditor()}
        onRedo={() => editorRef.current?.redo()}
        onSelectAll={() => {
          editorRef.current?.selectAll();
          window.requestAnimationFrame(() => editorRef.current?.selectAll());
        }}
        onUndo={() => editorRef.current?.undo()}
        target={editorMenu}
      />
    </section>
  );
});

export default EditorWorkspace;
