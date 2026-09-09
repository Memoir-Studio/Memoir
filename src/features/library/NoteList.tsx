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
  Upload,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  IconButton,
  Input,
  SegmentedControl,
  Surface,
  Tag,
} from "../../components/ui";
import { isTauriRuntime } from "../../platform/runtime";
import { useAppStore } from "../../store/app-store";
import { handleWindowDragMouseDown } from "../window/window-drag";
import { dateLocale, formatRelativeTime } from "../../i18n";
import type { AppLocale } from "../../i18n/locale";
import { useI18n } from "../../i18n/react";
import { AttachmentLibrary } from "../attachments/AttachmentLibrary";
import { CloudSyncPanel } from "../sync/CloudSyncPanel";
import { NoteGraphPanel } from "../graph/NoteGraphPanel";
import { IndexInspector } from "./IndexInspector";
import { NoteLinksPanel } from "./NoteLinksPanel";
import { NoteContextMenu, type NoteMenuTarget } from "./NoteContextMenu";
import { NoteOutline } from "./NoteOutline";
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
  style,
}: {
  onCreate: () => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onInsertAttachment?: (markdown: string) => void;
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

  return (
    <section data-note-list-panel="" {...stylex.props(noteListStyles.panel, style)}>
      {mode !== "sync" && (
        <header
          {...stylex.props(noteListStyles.header)}
          data-tauri-drag-region={isTauriRuntime() ? "" : undefined}
          onMouseDown={handleWindowDragMouseDown}
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
          {mode === "attachments" ? (
            <IconButton label={t("library.importAttachment")} onClick={() => void importAttachments()}>
              <Upload {...stylex.props(sharedLibraryStyles.icon)} />
            </IconButton>
          ) : mode === "index" || mode === "graph" ? (
            <span aria-hidden {...stylex.props(noteListStyles.headerSpacer)} />
          ) : (
            <IconButton label={t("library.newNote")} onClick={() => onCreate()}>
              <Plus {...stylex.props(sharedLibraryStyles.icon)} />
            </IconButton>
          )}
        </header>
      )}

      {mode === "attachments" ? (
        <AttachmentLibrary onInsert={onInsertAttachment} />
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
              placeholder={t("library.filterPlaceholder")}
              style={noteListStyles.searchInput}
              type="search"
              value={query}
            />
          </label>
          <div {...stylex.props(noteListStyles.countRow)}>
            <span>{tc("library.filteredCount", filteredNotes.length)}</span>
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
          <NoteCardWindow
            activePath={activePath}
            density={density}
            locale={locale}
            menuPath={menuTarget?.path ?? null}
            notes={filteredNotes}
            onOpenMenu={setMenuTarget}
            onSelect={selectNoteFromList}
          />
          {!filteredNotes.length && (
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

function NoteCardWindow({
  notes,
  activePath,
  menuPath,
  density,
  locale,
  onSelect,
  onOpenMenu,
}: {
  notes: NoteMeta[];
  activePath: string | null;
  menuPath: string | null;
  density: string;
  locale: AppLocale;
  onSelect: (path: string) => void;
  onOpenMenu: (target: NoteMenuTarget) => void;
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
      ) : (
        windowNotes.map((note) => (
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
        ))
      )}
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
        <div {...stylex.props(noteListStyles.tags)}>
          {note.tags.slice(0, 3).map((tag) => (
            <Tag key={tag}>#{tag}</Tag>
          ))}
        </div>
        <span {...stylex.props(noteListStyles.time)}>
          {formatRelativeTime(note.modifiedMs, locale)}
        </span>
      </div>
    </Surface>
  );
});
