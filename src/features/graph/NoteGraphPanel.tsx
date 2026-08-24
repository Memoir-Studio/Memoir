import { Network, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Input, cn } from "../../components/ui";
import { noteStem } from "../../domain/note-links";
import { useAppStore } from "../../store/app-store";
import { useI18n } from "../../i18n/react";
import { useNoteGraph } from "./useNoteGraph";

export function NoteGraphPanel() {
  const activePath = useAppStore((state) => state.activePath);
  const selectNote = useAppStore((state) => state.selectNote);
  const { graph, loading } = useNoteGraph();
  const { t, tc } = useI18n();
  const [query, setQuery] = useState("");
  const degrees = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of graph.nodes) map.set(node.relativePath, 0);
    for (const edge of graph.edges) {
      if (!edge.targetPath) continue;
      map.set(edge.sourcePath, (map.get(edge.sourcePath) ?? 0) + 1);
      map.set(edge.targetPath, (map.get(edge.targetPath) ?? 0) + 1);
    }
    return map;
  }, [graph]);
  const resolvedEdges = graph.edges.filter((edge) => edge.targetPath);
  const orphans = graph.nodes.filter((node) => (degrees.get(node.relativePath) ?? 0) === 0).length;
  const needle = query.trim().toLowerCase();
  const nodes = useMemo(() => {
    return [...graph.nodes]
      .filter((node) => {
        if (!needle) return true;
        return (
          node.title.toLowerCase().includes(needle) ||
          node.relativePath.toLowerCase().includes(needle)
        );
      })
      .sort(
        (left, right) =>
          (degrees.get(right.relativePath) ?? 0) - (degrees.get(left.relativePath) ?? 0) ||
          left.title.localeCompare(right.title),
      );
  }, [degrees, graph.nodes, needle]);

  return (
    <div className="memoir-fade-in flex min-h-0 flex-1 flex-col">
      <div className="graph-panel-stats mx-3 mt-2.5 grid grid-cols-3 gap-1.5">
        <div className="graph-stat">
          <p className="tabular-nums">{graph.nodes.length}</p>
          <span>{tc("graph.nodes", graph.nodes.length)}</span>
        </div>
        <div className="graph-stat">
          <p className="tabular-nums">{resolvedEdges.length}</p>
          <span>{tc("graph.edges", resolvedEdges.length)}</span>
        </div>
        <div className="graph-stat">
          <p className="tabular-nums">{orphans}</p>
          <span>{tc("graph.orphans", orphans)}</span>
        </div>
      </div>
      <label className="note-search relative mx-3 mt-2.5 block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <Input
          aria-label={t("graph.search")}
          className="h-8 rounded-[10px] pl-8 shadow-none"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("graph.searchPlaceholder")}
          type="search"
          value={query}
        />
      </label>
      <div className="min-h-0 flex-1 overflow-auto px-2.5 pb-3 pt-2">
        {loading && !graph.nodes.length ? (
          <p className="px-2 py-8 text-center text-xs text-muted">{t("app.loading")}</p>
        ) : !nodes.length ? (
          <p className="px-2 py-8 text-center text-xs text-muted">
            {graph.nodes.length ? t("graph.noMatches") : t("graph.empty")}
          </p>
        ) : (
          nodes.map((node) => {
            const degree = degrees.get(node.relativePath) ?? 0;
            return (
              <button
                className={cn(
                  "graph-node-row grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2.5 text-left",
                  activePath === node.relativePath && "is-active",
                )}
                key={node.relativePath}
                onClick={() => void selectNote(node.relativePath)}
                type="button"
              >
                <Network className="h-3.5 w-3.5 text-muted" strokeWidth={1.8} />
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-text">
                    {node.title || noteStem(node.relativePath)}
                  </span>
                  <span className="block truncate text-[10px] text-muted">{node.relativePath}</span>
                </span>
                <span className="tabular-nums text-[10px] text-muted">{degree}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
