import { useEffect, useMemo, useState } from "react";
import { mapGatewayError } from "../../domain/errors";
import { overlayLiveNoteGraph, type NoteGraph } from "../../domain/note-links";
import { getGateways } from "../../gateways";
import { useAppStore } from "../../store/app-store";
import { useI18n } from "../../i18n/react";

const EMPTY_GRAPH: NoteGraph = { nodes: [], edges: [] };
const inflight = new Map<string, Promise<NoteGraph>>();

function loadGraph(root: string, revision: string) {
  const key = `${root}\0${revision}`;
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = getGateways().workspace.getNoteGraph(root).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, request);
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
    void loadGraph(workspaceRoot, `${revision}:${savedContent}`)
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
  }, [revision, savedContent, t, workspaceRoot]);

  const liveGraph = useMemo(() => {
    if (!activePath || content === savedContent) return graph;
    return overlayLiveNoteGraph(graph, activePath, content);
  }, [activePath, content, graph, savedContent]);

  return { graph: liveGraph, loading };
}
