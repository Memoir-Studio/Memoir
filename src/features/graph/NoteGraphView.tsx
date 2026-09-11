import * as stylex from "@stylexjs/stylex";
import { ArrowUpRight, GitBranch, Maximize2, Network, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton, SegmentedControl, Toggle } from "../../components/ui";
import { noteStem } from "../../domain/note-links";
import { useAppStore } from "../../store/app-store";
import { useI18n } from "../../i18n/react";
import { degreesFromEdges } from "./force-layout";
import { NoteGraphScene } from "./graph-scene";
import { graphCardMarker, graphStyles } from "./graph-styles.stylex";
import { themeFromAppearance } from "./graph-theme";
import { useNoteGraph } from "./useNoteGraph";
import { WindowControls } from "../window/WindowChrome";

export default function NoteGraphView() {
  const activePath = useAppStore((state) => state.activePath);
  const isSidebarCollapsed = useAppStore((state) => state.isSidebarCollapsed);
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
  const graphTheme = themeFromAppearance(appearance);

  useEffect(() => {
    const host = stageRef.current;
    if (!host) return;
    const scene = new NoteGraphScene(host, graphTheme, {
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
    sceneRef.current?.setTheme(graphTheme);
  }, [graphTheme]);

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
    <section aria-label={t("graph.label")} {...stylex.props(graphStyles.view)}>
      <header {...stylex.props(graphStyles.header)}>
        <div {...stylex.props(graphStyles.minWidth)}>
          <h2 {...stylex.props(graphStyles.heading)}>
            {t("graph.label")}
          </h2>
          <p {...stylex.props(graphStyles.subtitle)}>{t("graph.hint")}</p>
        </div>
        <div {...stylex.props(graphStyles.headerActions)}>
          <SegmentedControl
            display="icon-text"
            label={t("graph.all")}
            onChange={(value) => setLocalOnly(value === "local")}
            options={[
              { value: "all", label: t("graph.all"), icon: <Network size={14} strokeWidth={1.8} /> },
              { value: "local", label: t("graph.local"), icon: <GitBranch size={14} strokeWidth={1.8} /> },
            ]}
            value={localOnly ? "local" : "all"}
          />
          <label {...stylex.props(graphStyles.orphanLabel)}>
            {t("graph.showOrphans")}
            <Toggle checked={showOrphans} label={t("graph.showOrphans")} onChange={setShowOrphans} />
          </label>
          <IconButton label={t("graph.fit")} onClick={() => sceneRef.current?.fit(true)}>
            <Maximize2 {...stylex.props(graphStyles.icon)} />
          </IconButton>
          <IconButton label={t("graph.reset")} onClick={() => sceneRef.current?.reset()}>
            <RotateCcw {...stylex.props(graphStyles.icon)} />
          </IconButton>
          {isSidebarCollapsed && <WindowControls inline position="right" />}
        </div>
      </header>
      <div {...stylex.props(graphStyles.stage)} ref={stageRef}>
        {!graph.nodes.length && (
          <div {...stylex.props(graphStyles.emptyOverlay)}>
            {t("graph.empty")}
          </div>
        )}
        <ul {...stylex.props(graphStyles.legend)}>
          <li {...stylex.props(graphStyles.legendItem)}>
            <span {...stylex.props(graphStyles.swatch, graphStyles.swatchSelected)} />
            {t("graph.legendSelected")}
          </li>
          <li {...stylex.props(graphStyles.legendItem)}>
            <span {...stylex.props(graphStyles.swatch, graphStyles.swatchLinked)} />
            {t("graph.legendLinked")}
          </li>
          <li {...stylex.props(graphStyles.legendItem)}>
            <span {...stylex.props(graphStyles.swatch, graphStyles.swatchEdge)} />
            {t("graph.legendEdge")}
          </li>
        </ul>
        {selected && (
          <button
            aria-label={t("graph.openNote")}
            onClick={() => openNoteRef.current(selected.relativePath)}
            onPointerDown={(event) => event.stopPropagation()}
            type="button"
            {...stylex.props(graphCardMarker, graphStyles.card)}
          >
            <Network {...stylex.props(graphStyles.cardIcon)} strokeWidth={1.8} />
            <span {...stylex.props(graphStyles.cardText)}>
              <span {...stylex.props(graphStyles.cardTitle)}>
                {selected.title || noteStem(selected.relativePath)}
              </span>
              <span {...stylex.props(graphStyles.cardPath)}>{selected.relativePath}</span>
              <span {...stylex.props(graphStyles.cardMeta)}>
                {tc("graph.connected", degrees.get(selected.relativePath) ?? 0)}
              </span>
            </span>
            <ArrowUpRight {...stylex.props(graphStyles.cardGo)} strokeWidth={1.8} />
          </button>
        )}
      </div>
    </section>
  );
}
