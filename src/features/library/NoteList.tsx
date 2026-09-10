import * as stylex from "@stylexjs/stylex";
import {
  ArrowDownWideNarrow,
  BookOpen,
  Code2,
  FileText,
  Link2,
  ListTree,
  Plus,
  Search,
  Star,
  Sparkles,
  Loader2,
  Upload,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  IconButton,
  Input,
  PanelHeader,
  SegmentedControl,
  Surface,
  Tag,
} from "../../components/ui";
import { useAppStore } from "../../store/app-store";
import { isTauriRuntime } from "../../platform/runtime";
import { dateLocale, formatRelativeTime } from "../../i18n";
import type { AppLocale } from "../../i18n/locale";
import { useI18n } from "../../i18n/react";
import { getGateways } from "../../gateways";
import { mapGatewayError } from "../../domain/errors";
import type { AiEditorEdit, AiRewriteTarget } from "../../domain/ai";
import type { SemanticSearchResult } from "../../domain/vector-index";
import { AttachmentLibrary } from "../attachments/AttachmentLibrary";
import { CloudSyncPanel } from "../sync/CloudSyncPanel";
import { AiRewritePanel } from "../editor/AiRewritePanel";
import { NoteGraphPanel } from "../graph/NoteGraphPanel";
import { IndexInspector } from "./IndexInspector";
import { NoteLinksPanel } from "./NoteLinksPanel";
import { NoteContextMenu, type NoteMenuTarget } from "./NoteContextMenu";
import { NoteOutline } from "./NoteOutline";
import { handleWindowDragMouseDown } from "../window/window-drag";
import type { NoteSortDirection, NoteSortField } from "../../domain/settings";
import { extractHeadings, noteDisplayName, sortLibraryNotes, stripFrontmatter } from "./note-utils";
import type { NoteMeta } from "../../domain/notes";
import { noteListStyles, sharedLibraryStyles } from "./library-styles.stylex";

export const NOTE_LIST_VIRTUAL_THRESHOLD = 80;
const VIRTUAL_OVERSCAN = 6;
const VIRTUAL_ROW_COMFORTABLE = 104;
const VIRTUAL_ROW_COMPACT = 88;

export function NoteList({
  onCreate,
  onRename,
  onDelete,
  onInsertAttachment,
  aiRewriteTarget = null,
  onApplyAiRewrite = () => false,
  onCloseAiRewrite = () => undefined,
  onRefreshAiRewriteTarget = () => null,
  onSaveAiRewrite = async () => false,
  style,
}: {
  onCreate: () => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onInsertAttachment?: (markdown: string) => void;
  aiRewriteTarget?: AiRewriteTarget | null;
  onApplyAiRewrite?: (edit: AiEditorEdit) => boolean;
  onCloseAiRewrite?: () => void;
  onRefreshAiRewriteTarget?: () => AiRewriteTarget | null;
  onSaveAiRewrite?: () => Promise<boolean>;
  style?: stylex.StyleXStyles;
}) {
  const notes = useAppStore((state) => state.notes);
  const activePath = useAppStore((state) => state.activePath);
  const mode = useAppStore((state) => state.libraryPanelMode);
  const content = useAppStore((state) => (state.libraryPanelMode === "outline" ? state.content : ""));
  const query = useAppStore((state) => state.query);
  const density = useAppStore((state) => state.settings.appearance.density);
  const settings = useAppStore((state) => state.settings);
  const setQuery = useAppStore((state) => state.setQuery);
  const setMode = useAppStore((state) => state.setLibraryPanelMode);
  const setSettings = useAppStore((state) => state.setSettings);
  const selectNote = useAppStore((state) => state.selectNote);
  const importAttachments = useAppStore((state) => state.importAttachments);
  const { t, tc, locale } = useI18n();
  const [menuTarget, setMenuTarget] = useState<NoteMenuTarget | null>(null);
  const [sortMenu, setSortMenu] = useState<{ x: number; y: number } | null>(null);
  const [semanticResults, setSemanticResults] = useState<SemanticSearchResult[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const noteSort = settings.general.noteSort;
  const noteSortDirection = settings.general.noteSortDirection;
  const filteredNotes = useMemo(
    () =>
      sortLibraryNotes(
        notes,
        { field: noteSort, direction: noteSortDirection },
        dateLocale(locale),
      ),
    [locale, noteSort, noteSortDirection, notes],
  );
  const semanticExtras = useMemo(() => {
    const seen = new Set(filteredNotes.map((note) => note.relativePath));
    return semanticResults.filter((result) => {
      if (seen.has(result.relativePath)) return false;
      seen.add(result.relativePath);
      return true;
    });
  }, [filteredNotes, semanticResults]);
  const resultCount = filteredNotes.length + semanticExtras.length;
  const selectNoteFromList = useCallback(
    (path: string) => void selectNote(path),
    [selectNote],
  );
  const applyNoteSort = (field: NoteSortField, direction: NoteSortDirection) => {
    setSettings({
      ...settings,
      general: {
        ...settings.general,
        noteSort: field,
        noteSortDirection: direction,
      },
    });
  };
  const headings = useMemo(() => {
    if (mode !== "outline") return [];
    return extractHeadings(stripFrontmatter(content));
  }, [content, mode]);

  useEffect(() => {
    const root = useAppStore.getState().workspaceRoot;
    const semanticQuery = query.trim();
    setSemanticResults([]);
    if (!root || !semanticQuery || !settings.ai.enabled) {
      setSemanticResults([]);
      setSemanticLoading(false);
      return;
    }
    let cancelled = false;
    setSemanticLoading(true);
    const timer = window.setTimeout(() => {
      void getGateways().workspace
        .semanticSearch(root, settings.ai, semanticQuery, 30)
        .then((results) => {
          if (!cancelled) setSemanticResults(results);
        })
        .catch((error) => {
          if (!cancelled) {
            useAppStore.setState({
              error: t("errors.vectorIndex", { message: mapGatewayError(error).message }),
            });
            setSemanticResults([]);
          }
        })
        .finally(() => {
          if (!cancelled) setSemanticLoading(false);
        });
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, settings.ai, t]);

  return (
    <section data-note-list-panel="" {...stylex.props(noteListStyles.panel, style)}>
      {mode !== "sync" && mode !== "ai" && (
        <PanelHeader
          dragRegion={isTauriRuntime()}
          onMouseDown={handleWindowDragMouseDown}
          style={noteListStyles.header}
          actions={
            mode === "attachments" ? (
              <IconButton label={t("library.importAttachment")} onClick={() => void importAttachments()}>
                <Upload {...stylex.props(sharedLibraryStyles.icon)} />
              </IconButton>
            ) : mode === "index" || mode === "graph" ? (
              <span aria-hidden {...stylex.props(noteListStyles.headerSpacer)} />
            ) : (
              <IconButton label={t("library.newNote")} onClick={() => onCreate()}>
                <Plus {...stylex.props(sharedLibraryStyles.icon)} />
              </IconButton>
            )
          }
        >
          {mode === "index" || mode === "attachments" || mode === "graph" ? (
            <h2 {...stylex.props(noteListStyles.title)}>
              {mode === "attachments"
                ? t("library.attachments")
                : mode === "graph"
                  ? t("library.graph")
                  : t("library.index")}
            </h2>
          ) : (
            <SegmentedControl
              display="icon-text"
              label={t("library.notes")}
              onChange={setMode}
              options={[
                { value: "notes", label: t("library.notes"), icon: <BookOpen size={14} /> },
                { value: "outline", label: t("library.outline"), icon: <ListTree size={14} /> },
                { value: "links", label: t("library.links"), icon: <Link2 size={14} /> },
              ]}
              value={mode}
            />
          )}
        </PanelHeader>
      )}

      {mode === "attachments" ? (
        <AttachmentLibrary onInsert={onInsertAttachment} />
      ) : mode === "ai" ? (
        <AiRewritePanel
          onApply={onApplyAiRewrite}
          onClose={onCloseAiRewrite}
          onRefreshTarget={onRefreshAiRewriteTarget}
          onSave={onSaveAiRewrite}
          settings={settings.ai}
          target={aiRewriteTarget}
        />
      ) : mode === "index" ? (
        <IndexInspector />
      ) : mode === "graph" ? (
        <NoteGraphPanel />
      ) : mode === "sync" ? (
        <CloudSyncPanel />
      ) : mode === "notes" ? (
        <div {...stylex.props(noteListStyles.notes, sharedLibraryStyles.fadeIn)}>
          <label {...stylex.props(noteListStyles.search)}>
            <Search {...stylex.props(noteListStyles.searchIcon)} />
            <Input
              aria-label={t("library.filterNotes")}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("library.searchPlaceholder")}
              style={noteListStyles.searchInput}
              type="search"
              value={query}
            />
          </label>
          <div {...stylex.props(noteListStyles.countRow)}>
            <span>{tc("library.filteredCount", resultCount)}</span>
            <div {...stylex.props(noteListStyles.countActions)}>
              {semanticLoading ? (
                <span title={t("library.semanticSearching")} {...stylex.props(noteListStyles.semanticProgress)}>
                  <Loader2 {...stylex.props(sharedLibraryStyles.iconSmall, sharedLibraryStyles.spin)} />
                </span>
              ) : null}
              <IconButton
                aria-expanded={Boolean(sortMenu)}
                aria-haspopup="menu"
                label={t("library.sort")}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setSortMenu({ x: rect.right - 8, y: rect.bottom + 4 });
                }}
                style={noteListStyles.compactButton}
              >
                <ArrowDownWideNarrow {...stylex.props(sharedLibraryStyles.iconSmall)} />
              </IconButton>
            </div>
          </div>
          <NoteCardWindow
            activePath={activePath}
            density={density}
            locale={locale}
            menuPath={menuTarget?.path ?? null}
            notes={filteredNotes}
            onOpenMenu={setMenuTarget}
            onSelect={selectNoteFromList}
            semanticLabel={t("library.semanticSupplement")}
            semanticResults={semanticExtras}
          />
          {!semanticLoading && !resultCount && (
            <p {...stylex.props(noteListStyles.empty)}>{t("library.noMatches")}</p>
          )}
        </div>
      ) : mode === "links" ? (
        <NoteLinksPanel />
      ) : (
        <NoteOutline documentKey={activePath} headings={headings} />
      )}
      <ContextMenu
        label={t("library.sort")}
        onClose={() => setSortMenu(null)}
        open={Boolean(sortMenu)}
        x={sortMenu?.x ?? 0}
        y={sortMenu?.y ?? 0}
      >
        <ContextMenuItem
          checked={noteSort === "name"}
          label={t("library.sortByName")}
          onSelect={() => applyNoteSort("name", noteSort === "name" ? noteSortDirection : "asc")}
        />
        <ContextMenuItem
          checked={noteSort === "modified"}
          label={t("library.sortByModified")}
          onSelect={() =>
            applyNoteSort("modified", noteSort === "modified" ? noteSortDirection : "desc")
          }
        />
        <ContextMenuItem
          checked={noteSort === "title"}
          label={t("library.sortByTitle")}
          onSelect={() => applyNoteSort("title", noteSort === "title" ? noteSortDirection : "asc")}
        />
        <ContextMenuSeparator />
        <ContextMenuItem
          checked={noteSortDirection === "asc"}
          label={t("library.sortAsc")}
          onSelect={() => applyNoteSort(noteSort, "asc")}
        />
        <ContextMenuItem
          checked={noteSortDirection === "desc"}
          label={t("library.sortDesc")}
          onSelect={() => applyNoteSort(noteSort, "desc")}
        />
      </ContextMenu>
      <NoteContextMenu
        onClose={() => setMenuTarget(null)}
        onDelete={onDelete}
        onRename={onRename}
        target={menuTarget}
      />
    </section>
  );
}

function SemanticResultCard({
  result,
  onSelect,
}: {
  result: SemanticSearchResult;
  onSelect: (path: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(result.relativePath)}
      type="button"
      {...stylex.props(noteListStyles.semanticCard)}
    >
      <span {...stylex.props(noteListStyles.semanticTitle)}>{result.title || result.relativePath}</span>
      <span {...stylex.props(noteListStyles.semanticPath)}>{result.relativePath}</span>
      <span {...stylex.props(noteListStyles.semanticExcerpt)}>
        {result.content.replace(/\s+/g, " ").trim()}
      </span>
      <span {...stylex.props(noteListStyles.semanticScore)}>{result.score.toFixed(3)}</span>
    </button>
  );
}

function NoteCardWindow({
  notes,
  activePath,
  menuPath,
  density,
  locale,
  onSelect,
  onOpenMenu,
  semanticLabel,
  semanticResults,
}: {
  notes: NoteMeta[];
  activePath: string | null;
  menuPath: string | null;
  density: string;
  locale: AppLocale;
  onSelect: (path: string) => void;
  onOpenMenu: (target: NoteMenuTarget) => void;
  semanticLabel: string;
  semanticResults: SemanticSearchResult[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);
  const virtual = notes.length > NOTE_LIST_VIRTUAL_THRESHOLD;
  const rowHeight = density === "compact" ? VIRTUAL_ROW_COMPACT : VIRTUAL_ROW_COMFORTABLE;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setHeight(el.clientHeight);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const start = virtual
    ? Math.max(0, Math.floor(scrollTop / rowHeight) - VIRTUAL_OVERSCAN)
    : 0;
  const visibleCount = virtual
    ? Math.max(1, Math.ceil((height || rowHeight) / rowHeight)) + VIRTUAL_OVERSCAN * 2
    : notes.length;
  const end = virtual ? Math.min(notes.length, start + visibleCount) : notes.length;
  const windowNotes = notes.slice(start, end);

  return (
    <div
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      ref={scrollRef}
      {...stylex.props(noteListStyles.scroll)}
    >
      {virtual ? (
        <>
          <div {...stylex.props(noteListStyles.virtualSpace(notes.length * rowHeight))}>
            {windowNotes.map((note, index) => (
              <div
                key={note.relativePath}
                {...stylex.props(noteListStyles.virtualRow((start + index) * rowHeight, rowHeight))}
              >
                <NoteCard
                  active={note.relativePath === activePath}
                  density={density}
                  locale={locale}
                  menuOpen={menuPath === note.relativePath}
                  note={note}
                  onOpenMenu={onOpenMenu}
                  onSelect={onSelect}
                />
              </div>
            ))}
          </div>
          <SemanticResultGroup label={semanticLabel} onSelect={onSelect} results={semanticResults} />
        </>
      ) : (
        <>
          {windowNotes.map((note) => (
            <NoteCard
              active={note.relativePath === activePath}
              density={density}
              key={note.relativePath}
              locale={locale}
              menuOpen={menuPath === note.relativePath}
              note={note}
              onOpenMenu={onOpenMenu}
              onSelect={onSelect}
            />
          ))}
          <SemanticResultGroup label={semanticLabel} onSelect={onSelect} results={semanticResults} />
        </>
      )}
    </div>
  );
}

function SemanticResultGroup({
  label,
  onSelect,
  results,
}: {
  label: string;
  onSelect: (path: string) => void;
  results: SemanticSearchResult[];
}) {
  if (!results.length) return null;
  return (
    <div {...stylex.props(noteListStyles.semanticGroup)}>
      <div {...stylex.props(noteListStyles.semanticGroupHeader)}>
        <Sparkles {...stylex.props(noteListStyles.semanticGroupIcon)} />
        <span>{label}</span>
      </div>
      {results.map((result) => (
        <SemanticResultCard
          key={`${result.relativePath}:${result.chunkIndex}`}
          onSelect={onSelect}
          result={result}
        />
      ))}
    </div>
  );
}

const NoteCard = memo(function NoteCard({
  note,
  active,
  menuOpen,
  density,
  locale,
  onSelect,
  onOpenMenu,
}: {
  note: NoteMeta;
  active: boolean;
  menuOpen: boolean;
  density: string;
  locale: AppLocale;
  onSelect: (path: string) => void;
  onOpenMenu: (target: NoteMenuTarget) => void;
}) {
  return (
    <Surface
      aria-expanded={menuOpen}
      aria-haspopup="menu"
      aria-label={noteDisplayName(note)}
      data-note-card={note.relativePath}
      onClick={() => onSelect(note.relativePath)}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenMenu({
          x: event.clientX,
          y: event.clientY,
          path: note.relativePath,
        });
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(note.relativePath);
          return;
        }
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenMenu({
            x: rect.left + 12,
            y: rect.bottom - 4,
            path: note.relativePath,
          });
        }
      }}
      role="button"
      style={[
        noteListStyles.card,
        density === "compact" ? noteListStyles.cardCompact : noteListStyles.cardComfortable,
        active && noteListStyles.cardActive,
        note.dirty && noteListStyles.cardDirty,
        menuOpen && noteListStyles.cardMenuTarget,
      ]}
      tabIndex={0}
    >
      <div {...stylex.props(noteListStyles.cardHeader)}>
        {note.extension === "mdx" ? (
          <Code2 {...stylex.props(noteListStyles.cardIcon)} />
        ) : (
          <FileText {...stylex.props(noteListStyles.cardIcon)} />
        )}
        <h3 {...stylex.props(noteListStyles.cardTitle)}>{noteDisplayName(note)}</h3>
        {note.favorite && <Star {...stylex.props(noteListStyles.favoriteIcon)} />}
      </div>
      <p {...stylex.props(noteListStyles.excerpt)}>
        {note.excerpt || note.relativePath}
      </p>
      <div {...stylex.props(noteListStyles.metadata)}>
        <div
          title={note.tags.map((tag) => `#${tag}`).join("  ")}
          {...stylex.props(noteListStyles.tags)}
        >
          {note.tags.slice(0, 3).map((tag) => (
            <Tag key={tag} style={noteListStyles.tag}>#{tag}</Tag>
          ))}
        </div>
        <span {...stylex.props(noteListStyles.time)}>
          {formatRelativeTime(note.modifiedMs, locale)}
        </span>
      </div>
    </Surface>
  );
});
