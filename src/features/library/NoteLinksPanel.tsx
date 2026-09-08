import * as stylex from "@stylexjs/stylex";
import { ArrowLeftRight, ArrowUpRight, FileQuestion, Link2 } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { noteRefsFromGraph, noteStem, type NoteLinkItem } from "../../domain/note-links";
import { useNoteGraph } from "../graph/useNoteGraph";
import { useAppStore } from "../../store/app-store";
import { useI18n } from "../../i18n/react";
import { linkStyles, sharedLibraryStyles } from "./library-styles.stylex";

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
      <div {...stylex.props(linkStyles.emptyPanel)}>
        {t("links.emptyNote")}
      </div>
    );
  }

  return (
    <div {...stylex.props(linkStyles.panel, sharedLibraryStyles.fadeIn)}>
      <LinkSection
        empty={t("links.emptyOutgoing")}
        icon={<ArrowUpRight {...stylex.props(sharedLibraryStyles.iconSmall)} />}
        items={outgoing}
        onOpen={(item) => item.targetPath && void selectNote(item.targetPath)}
        title={`${t("links.outgoing")} · ${tc("links.count", outgoing.length)}`}
        titleFor={(item) => item.targetTitle || item.displayText || item.targetRef}
        subtitleFor={(item) => item.targetPath || item.targetRef}
      />
      <LinkSection
        empty={t("links.emptyIncoming")}
        icon={<ArrowLeftRight {...stylex.props(sharedLibraryStyles.iconSmall)} />}
        items={refs.incoming}
        onOpen={(item) => void selectNote(item.sourcePath)}
        title={`${t("links.incoming")} · ${tc("links.count", refs.incoming.length)}`}
        titleFor={(item) => item.sourceTitle || noteStem(item.sourcePath)}
        subtitleFor={(item) => item.sourcePath}
      />
      <LinkSection
        empty={t("links.emptyUnresolved")}
        icon={<FileQuestion {...stylex.props(sharedLibraryStyles.iconSmall)} />}
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
    <section {...stylex.props(linkStyles.section)}>
      <h3 {...stylex.props(linkStyles.heading)}>
        {icon}
        {title}
      </h3>
      {items.length ? (
        <ul {...stylex.props(linkStyles.list)}>
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
        <p {...stylex.props(linkStyles.empty)}>{empty}</p>
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
  const inner = (
    <>
      <Link2 {...stylex.props(linkStyles.rowIcon)} strokeWidth={1.8} />
      <span {...stylex.props(sharedLibraryStyles.minWidth)}>
        <span {...stylex.props(linkStyles.rowTitle)}>{title}</span>
        <span {...stylex.props(linkStyles.rowSubtitle)}>{subtitle}</span>
      </span>
    </>
  );
  if (!onOpen) return <div {...stylex.props(linkStyles.row)}>{inner}</div>;
  return (
    <button onClick={onOpen} type="button" {...stylex.props(linkStyles.row, linkStyles.openable)}>
      {inner}
    </button>
  );
}
