import * as stylex from "@stylexjs/stylex";
import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { editorStyles } from "./editor-styles.stylex";

export const ExternalChange = Annotation.define<boolean>();
export const EDITOR_SNAPSHOT_DEBOUNCE_MS = 50;

export type CodeMirrorHostHandle = {
  getView: () => EditorView | null;
  flush: () => string;
};

export const CodeMirrorHost = forwardRef<
  CodeMirrorHostHandle,
  {
    doc: string;
    extensions: Extension[];
    debounceMs?: number;
    style?: stylex.StyleXStyles;
    onChange: (value: string) => void;
    onCreateEditor?: (view: EditorView) => void;
  }
>(function CodeMirrorHost(
  {
    doc,
    extensions,
    debounceMs = EDITOR_SNAPSHOT_DEBOUNCE_MS,
    style,
    onChange,
    onCreateEditor,
  },
  forwardedRef,
) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const compartmentRef = useRef(new Compartment());
  const lastEmittedRef = useRef(doc);
  const pendingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  const onCreateEditorRef = useRef(onCreateEditor);
  const extensionsRef = useRef(extensions);
  const debounceMsRef = useRef(debounceMs);
  onChangeRef.current = onChange;
  onCreateEditorRef.current = onCreateEditor;
  extensionsRef.current = extensions;
  debounceMsRef.current = debounceMs;

  const emitDoc = () => {
    const view = viewRef.current;
    const text = view ? view.state.doc.toString() : lastEmittedRef.current;
    if (text !== lastEmittedRef.current) {
      lastEmittedRef.current = text;
      onChangeRef.current(text);
    }
    return text;
  };

  const flush = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingRef.current = false;
    return emitDoc();
  };

  const scheduleFlush = () => {
    pendingRef.current = true;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      pendingRef.current = false;
      emitDoc();
    }, debounceMsRef.current);
  };
  const scheduleFlushRef = useRef(scheduleFlush);
  scheduleFlushRef.current = scheduleFlush;

  useImperativeHandle(
    forwardedRef,
    () => ({
      getView: () => viewRef.current,
      flush,
    }),
    [],
  );

  useLayoutEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;
    const compartment = compartmentRef.current;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          compartment.of(extensionsRef.current),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            if (update.transactions.some((transaction) => transaction.annotation(ExternalChange))) {
              return;
            }
            scheduleFlushRef.current();
          }),
        ],
      }),
    });
    viewRef.current = view;
    lastEmittedRef.current = view.state.doc.toString();
    onCreateEditorRef.current?.(view);
    return () => {
      flush();
      view.destroy();
      if (viewRef.current === view) viewRef.current = null;
    };
    // Created once per mount; note switches remount via `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skipReconfigureRef = useRef(true);
  useEffect(() => {
    if (skipReconfigureRef.current) {
      skipReconfigureRef.current = false;
      return;
    }
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: compartmentRef.current.reconfigure(extensions),
    });
  }, [extensions]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || pendingRef.current) return;
    if (doc === lastEmittedRef.current) return;
    const current = view.state.doc.toString();
    if (doc === current) {
      lastEmittedRef.current = doc;
      return;
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: doc },
      annotations: [ExternalChange.of(true)],
    });
    lastEmittedRef.current = doc;
  }, [doc]);

  return <div {...stylex.props(editorStyles.codeMirrorHost, style)} ref={parentRef} />;
});
