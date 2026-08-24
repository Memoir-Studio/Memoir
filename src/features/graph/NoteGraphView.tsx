import { ArrowUpRight, GitBranch, Maximize2, Network, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton, Toggle } from "../../components/ui";
import { noteStem } from "../../domain/note-links";
import { useAppStore } from "../../store/app-store";
import { useI18n } from "../../i18n/react";
import { degreesFromEdges } from "./force-layout";
import { NoteGraphScene } from "./graph-scene";
import { themeFromCss } from "./graph-theme";
import { useNoteGraph } from "./useNoteGraph";

export default function NoteGraphView() {
  const activePath = useAppStore((state) => state.activePath);
  const selectNote = useAppStore((state) => state.selectNote);
  const setLibraryPanelMode = useAppStore((state) => state.setLibraryPanelMode);
  const appearance = useAppStore((state) => state.settings.appearance);
  const { graph } = useNoteGraph();
  const { t, tc } = useI18n();
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<NoteGraphScene | null>(null);
  const selectNoteRef = useRef(selectNote);
  const openNoteRef = useRef((path: string) => {
    void selectNote(path);
    setLibraryPanelMode("notes");
  });
  const [showOrphans, setShowOrphans] = useState(true);
  const [localOnly, setLocalOnly] = useState(false);
  selectNoteRef.current = selectNote;
  openNoteRef.current = (path: string) => {
    void selectNote(path);
    setLibraryPanelMode("notes");
  };

  const resolvedEdges = useMemo(
    () =>
      graph.edges.filter(
        (edge): edge is typeof edge & { targetPath: string } =>
          Boolean(edge.targetPath) && edge.sourcePath !== edge.targetPath,
      ),
    [graph.edges],
  );
  const degrees = useMemo(
    () =>
      degreesFromEdges(
        graph.nodes.map((node) => node.relativePath),
        resolvedEdges.map((edge) => ({ source: edge.sourcePath, target: edge.targetPath })),
      ),
    [graph.nodes, resolvedEdges],
  );
  const visibleNodes = useMemo(() => {
    const connected = new Set<string>();
    if (localOnly && activePath) {
      connected.add(activePath);
      for (const edge of resolvedEdges) {
        if (edge.sourcePath === activePath) connected.add(edge.targetPath);
        if (edge.targetPath === activePath) connected.add(edge.sourcePath);
      }
    }
    return graph.nodes.filter((node) => {
      if (localOnly && activePath && !connected.has(node.relativePath)) return false;
      if (!showOrphans && (degrees.get(node.relativePath) ?? 0) === 0) return false;
      return true;
    });
  }, [activePath, degrees, graph.nodes, localOnly, resolvedEdges, showOrphans]);
  const visibleIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.relativePath)),
    [visibleNodes],
  );
  const visibleEdges = useMemo(
    () =>
      resolvedEdges.filter(
        (edge) => visibleIds.has(edge.sourcePath) && visibleIds.has(edge.targetPath),
      ),
    [resolvedEdges, visibleIds],
  );
  const selected = activePath
    ? graph.nodes.find((node) => node.relativePath === activePath)
    : undefined;

  useEffect(() => {
    const host = stageRef.current;
    if (!host) return;
    const scene = new NoteGraphScene(host, themeFromCss(), {
      onSelect: (id) => void selectNoteRef.current(id),
      onOpen: (id) => openNoteRef.current(id),
    });
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setTheme(themeFromCss());
  }, [appearance]);

  useEffect(() => {
    sceneRef.current?.setGraph(
      visibleNodes.map((node) => ({
        id: node.relativePath,
        title: node.title || noteStem(node.relativePath),
      })),
      visibleEdges.map((edge) => ({ source: edge.sourcePath, target: edge.targetPath })),
      activePath,
    );
  }, [activePath, visibleEdges, visibleNodes]);

  useEffect(() => {
    sceneRef.current?.setSelected(activePath);
  }, [activePath]);

  return (
    <section aria-label={t("graph.label")} className="note-graph-view flex h-full min-h-0 min-w-0 flex-col bg-canvas">
      <header className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-1.5">
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold tracking-[-0.02em] text-text">
            {t("graph.label")}
          </h2>
          <p className="truncate text-[11px] text-muted">{t("graph.hint")}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="view-switcher graph-mode-switcher flex items-center rounded-lg p-0.5" role="group">
            <IconButton
              active={!localOnly}
              label={t("graph.all")}
              onClick={() => setLocalOnly(false)}
            >
              <Network className="h-3.5 w-3.5" strokeWidth={1.8} />
              <span>{t("graph.all")}</span>
            </IconButton>
            <IconButton
              active={localOnly}
              label={t("graph.local")}
              onClick={() => setLocalOnly(true)}
            >
              <GitBranch className="h-3.5 w-3.5" strokeWidth={1.8} />
              <span>{t("graph.local")}</span>
            </IconButton>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-muted">
            {t("graph.showOrphans")}
            <Toggle checked={showOrphans} label={t("graph.showOrphans")} onChange={setShowOrphans} />
          </label>
          <IconButton label={t("graph.fit")} onClick={() => sceneRef.current?.fit(true)}>
            <Maximize2 className="h-4 w-4" />
          </IconButton>
          <IconButton label={t("graph.reset")} onClick={() => sceneRef.current?.reset()}>
            <RotateCcw className="h-4 w-4" />
          </IconButton>
        </div>
      </header>
      <div className="note-graph-stage relative min-h-0 flex-1 overflow-hidden" ref={stageRef}>
        {!graph.nodes.length && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center text-sm text-muted">
            {t("graph.empty")}
          </div>
        )}
        <ul className="note-graph-legend">
          <li>
            <span className="note-graph-swatch is-selected" />
            {t("graph.legendSelected")}
          </li>
          <li>
            <span className="note-graph-swatch is-linked" />
            {t("graph.legendLinked")}
          </li>
          <li>
            <span className="note-graph-swatch is-edge" />
            {t("graph.legendEdge")}
          </li>
        </ul>
        {selected && (
          <button
            aria-label={t("graph.openNote")}
            className="note-graph-card"
            onClick={() => openNoteRef.current(selected.relativePath)}
            onPointerDown={(event) => event.stopPropagation()}
            type="button"
          >
            <Network className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[13px] font-semibold text-text">
                {selected.title || noteStem(selected.relativePath)}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-muted">{selected.relativePath}</span>
              <span className="mt-1 block text-[11px] text-muted">
                {tc("graph.connected", degrees.get(selected.relativePath) ?? 0)}
              </span>
            </span>
            <ArrowUpRight className="note-graph-card-go mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          </button>
        )}
      </div>
    </section>
  );
}
