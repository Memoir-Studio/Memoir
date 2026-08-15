import {
  Bold,
  BookOpen,
  Braces,
  ExternalLink,
  FileDown,
  Heading2,
  Image,
  Italic,
  LayoutPanelLeft,
  Link,
  List,
  ListOrdered,
  Minus,
  Quote,
  Save,
  SplitSquareHorizontal,
  Star,
  Strikethrough,
  Trash2,
} from "lucide-react";
import { forwardRef, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { IconButton, cn } from "../../components/ui";
import { isTauriRuntime } from "../../platform/runtime";
import { useAppStore } from "../../store/app-store";
import { useI18n } from "../../i18n/react";
import { parseNote } from "../library/note-utils";
import { handleWindowDragMouseDown } from "../window/window-drag";
import { markdownForAttachments } from "../../domain/attachments";
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
import { getGateways } from "../../gateways";

const EditorPane = lazy(() => import("./EditorPane"));
const PreviewPane = lazy(() => import("../preview/PreviewPane"));

function PaneFallback({ label }: { label: string }) {
  return (
    <div className="grid min-h-0 min-w-0 place-items-center bg-canvas text-sm text-muted">
      {label}
    </div>
  );
}

export const EditorWorkspace = forwardRef<EditorHandle, {
  isDark: boolean;
  onRename: () => void;
  onDelete: () => void;
  className?: string;
}>(function EditorWorkspace(
  {
    isDark,
    onRename,
    onDelete,
    className,
  },
  forwardedRef,
) {
  const editorRef = useRef<EditorHandle>(null);
  const previewPaneRef = useRef<HTMLElement>(null);
  const ignoreScrollRef = useRef(false);
  const lastScrollSourceRef = useRef<"editor" | "preview" | null>(null);
  const pendingScrollRef = useRef<"editor" | "preview" | null>(null);
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
  const isSaving = useAppStore((state) => state.isSaving);
  const setContent = useAppStore((state) => state.setContent);
  const setViewMode = useAppStore((state) => state.setViewMode);
  const saveActiveNote = useAppStore((state) => state.saveActiveNote);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite);
  const savePastedImages = useAppStore((state) => state.savePastedImages);
  const importAttachments = useAppStore((state) => state.importAttachments);
  const { t } = useI18n();
  const [isExporting, setIsExporting] = useState(false);
  const untitled = t("editor.untitledFallback");
  const activeNote = notes.find((note) => note.relativePath === activePath) || null;
  const hasDocument = Boolean(activeNote && loadedContentPath === activePath);
  const parsed = useMemo(
    () => parseNote(hasDocument ? content : "", activeNote?.fileName || untitled),
    [activeNote?.fileName, content, hasDocument, untitled],
  );
  const isDirty = hasDocument && content !== savedContent;

  const lockForeignScroll = useCallback(() => {
    ignoreScrollRef.current = true;
    window.requestAnimationFrame(() => {
      ignoreScrollRef.current = false;
    });
  }, []);

  const applyScrollTop = useCallback((element: HTMLElement, nextTop: number) => {
    if (Math.abs(element.scrollTop - nextTop) < 1) return;
    lockForeignScroll();
    element.scrollTop = nextTop;
  }, [lockForeignScroll]);

  const getPreviewAnchors = useCallback(() => {
    const previewScroller = previewPaneRef.current;
    if (!previewScroller) return [];
    const cached = anchorCacheRef.current;
    if (cached && cached.content === content && cached.height === previewScroller.scrollHeight) {
      return cached.items;
    }
    const items = collectPreviewAnchors(
      previewScroller,
      bodySourceLineOffset(content, parsed.body),
    );
    anchorCacheRef.current = {
      content,
      height: previewScroller.scrollHeight,
      items,
    };
    return items;
  }, [content, parsed.body]);

  const performScrollSync = useCallback(
    (source: "editor" | "preview") => {
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
          previewScroller,
          scrollTopForLine(line, anchors, previewScroller, lastLine, previewOffset),
        );
        return;
      }
      lockForeignScroll();
      editor.scrollToLine(
        lineForScrollTop(previewScroller.scrollTop, anchors, previewScroller, lastLine, previewOffset),
        editorOffset,
      );
    },
    [applyScrollTop, content, getPreviewAnchors, lockForeignScroll],
  );

  const syncScroll = useCallback(
    (source: "editor" | "preview") => {
      if (ignoreScrollRef.current) return;
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

  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const previewObserverRef = useRef<ResizeObserver | null>(null);

  const attachPreviewArticle = useCallback(
    (node: HTMLElement | null) => {
      previewObserverRef.current?.disconnect();
      previewObserverRef.current = null;
      if (!node) return;
      const observer = new ResizeObserver(() => {
        if (viewModeRef.current !== "split") return;
        anchorCacheRef.current = null;
        if (lastScrollSourceRef.current === "preview" || ignoreScrollRef.current) return;
        performScrollSync("editor");
      });
      observer.observe(node);
      previewObserverRef.current = observer;
    },
    [performScrollSync],
  );

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) window.cancelAnimationFrame(scrollRafRef.current);
      previewObserverRef.current?.disconnect();
    };
  }, []);

  useImperativeHandle(
    forwardedRef,
    () => ({
      getScrollElement: () => editorRef.current?.getScrollElement() ?? null,
      getVisibleLine: (offset) => editorRef.current?.getVisibleLine(offset) ?? null,
      scrollToLine: (line, offset) => editorRef.current?.scrollToLine(line, offset),
      insertSnippet: (before, after, placeholder) =>
        editorRef.current?.insertSnippet(before, after, placeholder),
      insertText: (text) => editorRef.current?.insertText(text),
    }),
    [],
  );

  const insertSnippet = useCallback(
    (before: string, after = "", placeholder = "") => {
      editorRef.current?.insertSnippet(before, after, placeholder);
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
    { label: t("toolbar.heading2"), icon: Heading2, action: () => insertSnippet("## ", "", t("toolbar.placeholderHeading")) },
    { label: t("toolbar.bold"), icon: Bold, action: () => insertSnippet("**", "**", t("toolbar.placeholderText")), divider: true },
    { label: t("toolbar.italic"), icon: Italic, action: () => insertSnippet("_", "_", t("toolbar.placeholderText")) },
    { label: t("toolbar.strikethrough"), icon: Strikethrough, action: () => insertSnippet("~~", "~~", t("toolbar.placeholderText")) },
    { label: t("toolbar.link"), icon: Link, action: () => insertSnippet("[", "](https://)", t("toolbar.placeholderLink")), divider: true },
    { label: t("toolbar.image"), icon: Image, action: () => void insertImportedImages() },
    { label: t("toolbar.quote"), icon: Quote, action: () => insertSnippet("> ", "", t("toolbar.placeholderQuote")), divider: true },
    { label: t("toolbar.bulletList"), icon: List, action: () => insertSnippet("- ", "", t("toolbar.placeholderItem")) },
    { label: t("toolbar.orderedList"), icon: ListOrdered, action: () => insertSnippet("1. ", "", t("toolbar.placeholderItem")) },
    { label: t("toolbar.code"), icon: Braces, action: () => insertSnippet("`", "`", "code"), divider: true },
    { label: t("toolbar.rule"), icon: Minus, action: () => insertSnippet("\n---\n") },
  ];

  return (
    <section
      className={cn(
        "editor-workspace grid min-h-0 min-w-0 grid-rows-[56px_42px_minmax(0,1fr)] bg-canvas",
        className,
      )}
    >
      <header
        className="workspace-header flex min-w-0 items-center justify-between border-b border-border px-4"
        data-tauri-drag-region={isTauriRuntime() ? "" : undefined}
        onMouseDown={handleWindowDragMouseDown}
      >
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-semibold tracking-[-0.01em] text-text">
            {hasDocument ? parsed.title : t("editor.noNoteTitle")}
          </h2>
          <p className="mt-0.5 truncate text-[10px] text-muted">
            {hasDocument ? activePath : t("editor.noNoteSubtitle")}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            aria-label={isSaving ? t("editor.saving") : isDirty ? t("editor.unsaved") : t("editor.saved")}
            aria-live="polite"
            className="save-state-dot mr-1"
            data-state={isSaving ? "saving" : isDirty ? "dirty" : "saved"}
            role="status"
            title={isSaving ? t("editor.saving") : isDirty ? t("editor.unsaved") : t("editor.saved")}
          />
          <div className="view-switcher flex items-center rounded-lg p-0.5">
            <IconButton
              active={viewMode === "edit"}
              label={t("editor.edit")}
              onClick={() => setViewMode("edit")}
            >
              <BookOpen className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              active={viewMode === "split"}
              label={t("editor.split")}
              onClick={() => setViewMode("split")}
            >
              <SplitSquareHorizontal className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              active={viewMode === "preview"}
              label={t("editor.preview")}
              onClick={() => setViewMode("preview")}
            >
              <LayoutPanelLeft className="h-3.5 w-3.5" />
            </IconButton>
          </div>
          <IconButton active={activeNote?.favorite} label={t("editor.favorite")} onClick={() => void toggleFavorite()}>
            <Star className={cn("h-4 w-4 transition-colors duration-150", activeNote?.favorite && "fill-accent")} />
          </IconButton>
          <IconButton label={t("editor.save")} onClick={() => void saveActiveNote()}>
            <Save className="h-4 w-4" />
          </IconButton>
          <IconButton
            disabled={!hasDocument || isExporting}
            label={isExporting ? t("editor.exportingPdf") : t("editor.exportPdf")}
            onClick={() => void exportActivePdf()}
          >
            <FileDown className="h-4 w-4" />
          </IconButton>
          <IconButton
            className="max-[760px]:hidden"
            label={t("editor.openInSystem")}
            onClick={() =>
              workspaceRoot &&
              activePath &&
              void getGateways().workspace.openPath(`${workspaceRoot}/${activePath}`)
            }
          >
            <ExternalLink className="h-4 w-4" />
          </IconButton>
          <IconButton className="max-[760px]:hidden" label={t("editor.rename")} onClick={onRename}>
            <Braces className="h-4 w-4" />
          </IconButton>
          <IconButton className="max-[760px]:hidden" label={t("editor.delete")} onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </header>
      <div
        aria-label={t("editor.toolbar")}
        className="markdown-toolbar flex items-center gap-0.5 overflow-x-auto border-b border-border px-3.5"
        role="toolbar"
      >
        {toolbar.map(({ label, icon: Icon, action, divider }) => (
          <div className={cn("flex items-center", divider && "toolbar-divider ml-1 pl-1")} key={label}>
            <IconButton className="format-button" label={label} onClick={action}>
              <Icon className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        ))}
      </div>

      {!hasDocument ? (
        <div className="grid place-items-center p-6 text-center">
          <div>
            <h2 className="text-lg font-bold text-text">{t("editor.emptyTitle")}</h2>
            <p className="mt-2 text-sm text-muted">{t("editor.emptyBody")}</p>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "grid min-h-0 min-w-0 overflow-hidden",
            viewMode === "split" && "grid-cols-2 max-[760px]:grid-cols-1",
            viewMode !== "split" && "grid-cols-1",
          )}
        >
          {viewMode !== "preview" && (
            <Suspense fallback={<PaneFallback label={t("editor.loadingEditor")} />}>
              <EditorPane
                content={content}
                fileName={activeNote?.fileName || untitled}
                isDark={isDark}
                onChange={setContent}
                onPasteImages={savePastedImages}
                onScroll={() => syncScroll("editor")}
                ref={editorRef}
                settings={settings}
              />
            </Suspense>
          )}
          {viewMode !== "edit" && (
            <Suspense fallback={<PaneFallback label={t("editor.loadingPreview")} />}>
              <PreviewPane
                activePath={activePath}
                articleRef={attachPreviewArticle}
                content={content}
                note={activeNote}
                onContentChange={setContent}
                onScroll={() => syncScroll("preview")}
                paneRef={previewPaneRef}
                root={workspaceRoot}
              />
            </Suspense>
          )}
        </div>
      )}
    </section>
  );
});

export default EditorWorkspace;
