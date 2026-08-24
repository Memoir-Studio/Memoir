import { ArrowLeftRight, ArrowUpRight, FileQuestion, Link2 } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { cn } from "../../components/ui";
import { noteRefsFromGraph, noteStem, type NoteLinkItem } from "../../domain/note-links";
import { useNoteGraph } from "../graph/useNoteGraph";
import { useAppStore } from "../../store/app-store";
import { useI18n } from "../../i18n/react";

export function NoteLinksPanel() {
  const activePath = useAppStore((state) => state.activePath);
  const selectNote = useAppStore((state) => state.selectNote);
  const { graph } = useNoteGraph();
  const { t, tc } = useI18n();
  const refs = useMemo(() => {
    if (!activePath) return { outgoing: [], incoming: [], unresolved: [] };
    return noteRefsFromGraph(graph, activePath);
  }, [activePath, graph]);
  const outgoing = refs.outgoing.filter((item) => item.targetPath);

  if (!activePath) {
    return (
      <div className="grid flex-1 place-items-center px-6 text-center text-xs text-muted">
        {t("links.emptyNote")}
      </div>
    );
  }

  return (
    <div className="note-links-panel memoir-fade-in flex min-h-0 flex-1 flex-col overflow-auto px-3 pb-4 pt-2.5">
      <LinkSection
        empty={t("links.emptyOutgoing")}
        icon={<ArrowUpRight className="h-3.5 w-3.5" />}
        items={outgoing}
        onOpen={(item) => item.targetPath && void selectNote(item.targetPath)}
        title={`${t("links.outgoing")} · ${tc("links.count", outgoing.length)}`}
        titleFor={(item) => item.targetTitle || item.displayText || item.targetRef}
        subtitleFor={(item) => item.targetPath || item.targetRef}
      />
      <LinkSection
        empty={t("links.emptyIncoming")}
        icon={<ArrowLeftRight className="h-3.5 w-3.5" />}
        items={refs.incoming}
        onOpen={(item) => void selectNote(item.sourcePath)}
        title={`${t("links.incoming")} · ${tc("links.count", refs.incoming.length)}`}
        titleFor={(item) => item.sourceTitle || noteStem(item.sourcePath)}
        subtitleFor={(item) => item.sourcePath}
      />
      <LinkSection
        empty={t("links.emptyUnresolved")}
        icon={<FileQuestion className="h-3.5 w-3.5" />}
        items={refs.unresolved}
        title={`${t("links.unresolved")} · ${tc("links.count", refs.unresolved.length)}`}
        titleFor={(item) => item.displayText || item.targetRef}
        subtitleFor={() => t("links.missing")}
      />
    </div>
  );
}

function LinkSection({
  title,
  empty,
  items,
  icon,
  onOpen,
  titleFor,
  subtitleFor,
}: {
  title: string;
  empty: string;
  items: NoteLinkItem[];
  icon: ReactNode;
  onOpen?: (item: NoteLinkItem) => void;
  titleFor: (item: NoteLinkItem) => string;
  subtitleFor: (item: NoteLinkItem) => string;
}) {
  return (
    <section className="mb-4">
      <h3 className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] font-medium text-muted">
        {icon}
        {title}
      </h3>
      {items.length ? (
        <ul className="grid gap-1">
          {items.map((item) => (
            <li key={`${item.sourcePath}:${item.targetRef}:${item.kind}:${item.heading}`}>
              <LinkRow
                onOpen={onOpen ? () => onOpen(item) : undefined}
                subtitle={subtitleFor(item)}
                title={titleFor(item)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-1 text-[11px] leading-5 text-muted">{empty}</p>
      )}
    </section>
  );
}

function LinkRow({
  title,
  subtitle,
  onOpen,
}: {
  title: string;
  subtitle: string;
  onOpen?: () => void;
}) {
  const className = cn(
    "note-link-row grid w-full grid-cols-[16px_minmax(0,1fr)] items-start gap-2 rounded-lg px-2 py-1.5 text-left",
    onOpen && "is-openable",
  );
  const inner = (
    <>
      <Link2 className="mt-0.5 h-3.5 w-3.5 text-muted" strokeWidth={1.8} />
      <span className="min-w-0">
        <span className="block truncate text-[12px] font-medium text-text">{title}</span>
        <span className="block truncate text-[10px] text-muted">{subtitle}</span>
      </span>
    </>
  );
  if (!onOpen) return <div className={className}>{inner}</div>;
  return (
    <button className={className} onClick={onOpen} type="button">
      {inner}
    </button>
  );
}
