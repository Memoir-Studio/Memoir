import * as stylex from "@stylexjs/stylex";
import { Network, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "../../components/ui";
import { noteStem } from "../../domain/note-links";
import { useAppStore } from "../../store/app-store";
import { useI18n } from "../../i18n/react";
import { useNoteGraph } from "./useNoteGraph";
import { graphStyles } from "./graph-styles.stylex";

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
    <div {...stylex.props(graphStyles.panel)}>
      <div {...stylex.props(graphStyles.stats)}>
        <div {...stylex.props(graphStyles.stat)}>
          <p {...stylex.props(graphStyles.statValue)}>{graph.nodes.length}</p>
          <span {...stylex.props(graphStyles.statLabel)}>{tc("graph.nodes", graph.nodes.length)}</span>
        </div>
        <div {...stylex.props(graphStyles.stat)}>
          <p {...stylex.props(graphStyles.statValue)}>{resolvedEdges.length}</p>
          <span {...stylex.props(graphStyles.statLabel)}>{tc("graph.edges", resolvedEdges.length)}</span>
        </div>
        <div {...stylex.props(graphStyles.stat)}>
          <p {...stylex.props(graphStyles.statValue)}>{orphans}</p>
          <span {...stylex.props(graphStyles.statLabel)}>{tc("graph.orphans", orphans)}</span>
        </div>
      </div>
      <label {...stylex.props(graphStyles.search)}>
        <Search {...stylex.props(graphStyles.searchIcon)} />
        <Input
          aria-label={t("graph.search")}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("graph.searchPlaceholder")}
          style={graphStyles.searchInput}
          type="search"
          value={query}
        />
      </label>
      <div {...stylex.props(graphStyles.panelScroller)}>
        {loading && !graph.nodes.length ? (
          <p {...stylex.props(graphStyles.panelMessage)}>{t("app.loading")}</p>
        ) : !nodes.length ? (
          <p {...stylex.props(graphStyles.panelMessage)}>
            {graph.nodes.length ? t("graph.noMatches") : t("graph.empty")}
          </p>
        ) : (
          nodes.map((node) => {
            const degree = degrees.get(node.relativePath) ?? 0;
            return (
              <button
                key={node.relativePath}
                onClick={() => void selectNote(node.relativePath)}
                type="button"
                {...stylex.props(
                  graphStyles.nodeRow,
                  activePath === node.relativePath && graphStyles.nodeRowActive,
                )}
              >
                <Network {...stylex.props(graphStyles.nodeIcon)} strokeWidth={1.8} />
                <span {...stylex.props(graphStyles.minWidth)}>
                  <span {...stylex.props(graphStyles.nodeTitle)}>
                    {node.title || noteStem(node.relativePath)}
                  </span>
                  <span {...stylex.props(graphStyles.nodePath)}>{node.relativePath}</span>
                </span>
                <span {...stylex.props(graphStyles.degree)}>{degree}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
