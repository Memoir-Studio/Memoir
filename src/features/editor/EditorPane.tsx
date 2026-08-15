import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { EditorSelection } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { collectClipboardImages } from "../../domain/attachments";
import type { AppSettings } from "../../domain/settings";
import { useI18n } from "../../i18n/react";
import { noteStats, parseNote } from "../library/note-utils";
import { Tag } from "../../components/ui";

function insertAt(view: EditorView, from: number, to: number, text: string) {
  const insertFrom = Math.min(from, view.state.doc.length);
  const insertTo = Math.min(Math.max(to, insertFrom), view.state.doc.length);
  view.dispatch({
    changes: { from: insertFrom, to: insertTo, insert: text },
    selection: EditorSelection.cursor(insertFrom + text.length),
  });
  view.focus();
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
          if (markdown) insertAt(view, from, to, markdown);
        });
        return true;
      },
      drop(event, view) {
        if (!onPasteImages) return false;
        const files = collectClipboardImages(event.dataTransfer);
        if (!files.length) return false;
        event.preventDefault();
        const position =
          view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.from;
        void onPasteImages(files).then((markdown) => {
          if (markdown) insertAt(view, position, position, markdown);
        });
        return true;
      },
      dragover(event) {
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
  insertSnippet: (before: string, after?: string, placeholder?: string) => void;
  insertText: (text: string) => void;
}

interface EditorPaneProps {
  content: string;
  settings: AppSettings;
  isDark: boolean;
  fileName: string;
  onChange: (content: string) => void;
  onScroll?: () => void;
  onPasteImages?: (files: File[]) => Promise<string>;
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
  },
  forwardedRef,
) {
  const { t, tc } = useI18n();
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const extensions = useMemo(
    () => createEditorExtensions(isDark, settings.editor, onPasteImages),
    [isDark, onPasteImages, settings.editor],
  );
  const parsed = useMemo(() => parseNote(content, fileName), [content, fileName]);
  const stats = useMemo(() => noteStats(content), [content]);

  useImperativeHandle(
    forwardedRef,
    () => ({
      getScrollElement: () => editorRef.current?.view?.scrollDOM || null,
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
        insertAt(view, selection.from, selection.to, text);
      },
    }),
    [],
  );

  return (
    <section
      aria-label={t("editor.markdownEditor")}
      className="editor-pane relative min-h-0 min-w-0 overflow-hidden border-r border-border bg-canvas max-[760px]:min-h-[calc(100vh-138px)] max-[760px]:border-r-0"
    >
      <CodeMirror
        basicSetup={false}
        className="h-full"
        extensions={extensions}
        height="100%"
        onChange={onChange}
        onUpdate={(update) => {
          if (update.docChanged || update.selectionSet || update.viewportChanged) onScroll?.();
        }}
        ref={editorRef}
        value={content}
      />
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
