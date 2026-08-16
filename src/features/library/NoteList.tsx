import {
  ArrowDownWideNarrow,
  BookOpen,
  Code2,
  FileText,
  ListTree,
  Loader2,
  Plus,
  Search,
  Star,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton, Input, Surface, Tag, cn } from "../../components/ui";
import { isTauriRuntime } from "../../platform/runtime";
import { useAppStore } from "../../store/app-store";
import { handleWindowDragMouseDown } from "../window/window-drag";
import { formatRelativeTime } from "../../i18n";
import type { AppLocale } from "../../i18n/locale";
import { useI18n } from "../../i18n/react";
import { AttachmentLibrary } from "../attachments/AttachmentLibrary";
import { CloudSyncPanel } from "../sync/CloudSyncPanel";
import { IndexInspector } from "./IndexInspector";
import { NoteContextMenu, type NoteMenuTarget } from "./NoteContextMenu";
import { NoteOutline } from "./NoteOutline";
import { extractHeadings, parseNote } from "./note-utils";
import type { NoteMeta } from "../../domain/notes";

export const NOTE_LIST_VIRTUAL_THRESHOLD = 80;
const VIRTUAL_OVERSCAN = 6;
const VIRTUAL_ROW_COMFORTABLE = 104;
const VIRTUAL_ROW_COMPACT = 88;

export function NoteList({
  onCreate,
  onRename,
  onDelete,
  onInsertAttachment,
  className,
}: {
  onCreate: () => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  onInsertAttachment?: (markdown: string) => void;
  className?: string;
}) {
  const notes = useAppStore((state) => state.notes);
  const activePath = useAppStore((state) => state.activePath);
  const content = useAppStore((state) => state.content);
  const query = useAppStore((state) => state.query);
  const mode = useAppStore((state) => state.libraryPanelMode);
  const isLoading = useAppStore((state) => state.isLoading);
  const density = useAppStore((state) => state.settings.appearance.density);
  const setQuery = useAppStore((state) => state.setQuery);
  const setMode = useAppStore((state) => state.setLibraryPanelMode);
  const selectNote = useAppStore((state) => state.selectNote);
  const importAttachments = useAppStore((state) => state.importAttachments);
  const { t, tc, locale } = useI18n();
  const [menuTarget, setMenuTarget] = useState<NoteMenuTarget | null>(null);
  const filteredNotes = notes;
  const activeNote = notes.find((note) => note.relativePath === activePath);
  const untitled = t("editor.untitledFallback");
  const headings = useMemo(
    () => extractHeadings(parseNote(content, activeNote?.fileName || untitled).body),
    [activeNote?.fileName, content, untitled],
  );

  return (
    <section
      className={cn(
        "note-list-panel flex min-h-0 min-w-0 w-full flex-col border-r border-border bg-panel",
        className,
      )}
    >
      <header
        className="flex h-14 shrink-0 items-center justify-between gap-2 px-4"
        data-tauri-drag-region={isTauriRuntime() ? "" : undefined}
        onMouseDown={handleWindowDragMouseDown}
      >
        {mode === "index" || mode === "sync" || mode === "attachments" ? (
          <h2 className="text-[13px] font-semibold tracking-[-0.02em] text-text">
            {mode === "sync"
              ? t("library.cloudSync")
              : mode === "attachments"
                ? t("library.attachments")
                : t("library.index")}
          </h2>
        ) : (
          <div className="view-switcher library-mode-switcher flex items-center rounded-lg p-0.5">
            <IconButton
              active={mode === "notes"}
              label={t("library.notes")}
              onClick={() => setMode("notes")}
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>{t("library.notes")}</span>
            </IconButton>
            <IconButton
              active={mode === "outline"}
              label={t("library.outline")}
              onClick={() => setMode("outline")}
            >
              <ListTree className="h-3.5 w-3.5" />
              <span>{t("library.outline")}</span>
            </IconButton>
          </div>
        )}
        {mode === "attachments" ? (
          <IconButton label={t("library.importAttachment")} onClick={() => void importAttachments()}>
            <Upload className="h-4 w-4" />
          </IconButton>
        ) : mode === "index" || mode === "sync" ? (
          <span aria-hidden className="h-8 w-8" />
        ) : (
          <IconButton label={t("library.newNote")} onClick={onCreate}>
            <Plus className="h-4 w-4" />
          </IconButton>
        )}
      </header>

      {mode === "attachments" ? (
        <AttachmentLibrary onInsert={onInsertAttachment} />
      ) : mode === "index" ? (
        <IndexInspector />
      ) : mode === "sync" ? (
        <CloudSyncPanel />
      ) : mode === "notes" ? (
        <div className="memoir-fade-in flex min-h-0 flex-1 flex-col">
          <label className="note-search relative mx-3 mt-2.5 block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <Input
              aria-label={t("library.filterNotes")}
              className="h-8 rounded-[10px] pl-8 shadow-none"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("library.filterPlaceholder")}
              type="search"
              value={query}
            />
          </label>
          <div className="flex items-center justify-between px-4 pb-2 pt-3 text-[11px] font-medium text-muted">
            <span>{tc("library.filteredCount", filteredNotes.length)}</span>
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowDownWideNarrow className="h-3.5 w-3.5" />
            )}
          </div>
          <NoteCardWindow
            activePath={activePath}
            density={density}
            locale={locale}
            menuPath={menuTarget?.path ?? null}
            notes={filteredNotes}
            onOpenMenu={setMenuTarget}
            onSelect={(path) => void selectNote(path)}
          />
          {!filteredNotes.length && (
            <p className="px-3 py-8 text-center text-xs text-muted">{t("library.noMatches")}</p>
          )}
        </div>
      ) : (
        <NoteOutline documentKey={activePath} headings={headings} />
      )}
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
      className="note-list-scroll grid flex-1 content-start gap-1.5 overflow-auto px-2.5 pb-3"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      ref={scrollRef}
    >
      {virtual ? (
        <div style={{ height: notes.length * rowHeight, position: "relative" }}>
          {windowNotes.map((note, index) => (
            <div
              key={note.relativePath}
              style={{
                position: "absolute",
                top: (start + index) * rowHeight,
                left: 0,
                right: 0,
                height: rowHeight,
              }}
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

function NoteCard({
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
      aria-label={note.title}
      className={cn(
        "note-card group cursor-pointer rounded-lg border-transparent bg-transparent shadow-none",
        density === "compact" ? "px-3 py-2.5" : "px-3 py-3",
        active && "is-active",
        note.dirty && "is-dirty",
        menuOpen && "is-menu-target",
      )}
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
      tabIndex={0}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        {note.extension === "mdx" ? (
          <Code2 className="h-3.5 w-3.5 text-accent" />
        ) : (
          <FileText className="h-3.5 w-3.5 text-accent" />
        )}
        <h3 className="truncate text-[13px] font-semibold text-text">{note.title}</h3>
        {note.favorite && <Star className="h-3.5 w-3.5 fill-accent text-accent" />}
      </div>
      <p className="mt-1.5 line-clamp-2 text-[11px] leading-[1.65] text-muted">
        {note.excerpt || note.relativePath}
      </p>
      <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          {note.tags.slice(0, 3).map((tag) => (
            <Tag key={tag}>#{tag}</Tag>
          ))}
        </div>
        <span className="shrink-0 text-[9px] text-muted">
          {formatRelativeTime(note.modifiedMs, locale)}
        </span>
      </div>
    </Surface>
  );
}
