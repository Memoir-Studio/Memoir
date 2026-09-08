import { useEffect, useMemo, useState } from "react";
import { mapGatewayError } from "../../domain/errors";
import { overlayLiveNoteGraph, type NoteGraph } from "../../domain/note-links";
import { getGateways } from "../../gateways";
import { useAppStore } from "../../store/app-store";
import { useI18n } from "../../i18n/react";

const EMPTY_GRAPH: NoteGraph = { nodes: [], edges: [] };
let inflight: {
  gateway: ReturnType<typeof getGateways>["workspace"];
  key: string;
  request: Promise<NoteGraph>;
} | null = null;
let cached: {
  gateway: ReturnType<typeof getGateways>["workspace"];
  key: string;
  graph: NoteGraph;
} | null = null;

function loadGraph(root: string, revision: string) {
  const key = `${root}\0${revision}`;
  const gateway = getGateways().workspace;
  if (cached?.gateway === gateway && cached.key === key) return Promise.resolve(cached.graph);
  if (inflight?.gateway === gateway && inflight.key === key) return inflight.request;
  const request = gateway.getNoteGraph(root).then((graph) => {
    cached = { gateway, key, graph };
    return graph;
  }).finally(() => {
    if (inflight?.request === request) inflight = null;
  });
  inflight = { gateway, key, request };
  return request;
}

export function useNoteGraph() {
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const notes = useAppStore((state) => state.notes);
  const activePath = useAppStore((state) => state.activePath);
  const content = useAppStore((state) => state.content);
  const savedContent = useAppStore((state) => state.savedContent);
  const { t } = useI18n();
  const [graph, setGraph] = useState<NoteGraph>(EMPTY_GRAPH);
  const [loading, setLoading] = useState(false);
  const revision = useMemo(
    () => notes.map((note) => `${note.relativePath}:${note.title}:${note.modifiedMs}`).join("|"),
    [notes],
  );

  useEffect(() => {
    if (!workspaceRoot) {
      setGraph(EMPTY_GRAPH);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadGraph(workspaceRoot, revision)
      .then((next) => {
        if (!cancelled) setGraph(next);
      })
      .catch((error) => {
        if (!cancelled) {
          setGraph(EMPTY_GRAPH);
          useAppStore.setState({
            error: t("errors.loadGraph", { message: mapGatewayError(error).message }),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [revision, t, workspaceRoot]);

  const liveGraph = useMemo(() => {
    if (!activePath || content === savedContent) return graph;
    return overlayLiveNoteGraph(graph, activePath, content);
  }, [activePath, content, graph, savedContent]);

  return { graph: liveGraph, loading };
}
