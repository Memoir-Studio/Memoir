import {
  Clock3,
  FileText,
  Folder,
  FolderOpen,
  Inbox,
  Moon,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SmilePlus,
  Star,
  Sun,
  Tag as TagIcon,
} from "lucide-react";
import { useState, type MouseEvent, type ReactNode } from "react";
import { IconButton, cn } from "../../components/ui";
import type { FolderAppearance } from "../../domain/folders";
import { isTauriRuntime } from "../../platform/runtime";
import { useAppStore } from "../../store/app-store";
import { handleWindowDragMouseDown } from "../window/window-drag";
import { useI18n } from "../../i18n/react";
import { dateLocale } from "../../i18n";
import { WorkspaceSwitcher } from "../workspace/WorkspaceSwitcher";
import { FolderAppearanceDialog } from "./FolderAppearanceDialog";
import { FolderContextMenu, type FolderMenuTarget } from "./FolderContextMenu";
import { folderName, isRootFolder, normalizeTag, uniqueSorted } from "./note-utils";

function NavButton({
  label,
  count,
  active,
  collapsed,
  icon,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  collapsed: boolean;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "sidebar-nav-item grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2.5 text-left",
        collapsed &&
          "min-[761px]:grid-cols-1 min-[761px]:justify-items-center min-[761px]:gap-0 min-[761px]:px-0",
        active && "is-active",
      )}
      onClick={onClick}
      title={collapsed ? label : undefined}
      type="button"
    >
      <span className="sidebar-nav-icon" aria-hidden="true">
        {icon}
      </span>
      <span className={cn("truncate", collapsed && "min-[761px]:hidden")}>{label}</span>
      <span
        className={cn(
          "sidebar-nav-count tabular-nums",
          collapsed && "min-[761px]:hidden",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function FolderGlyph({
  folder,
  appearance,
}: {
  folder: string;
  appearance?: FolderAppearance;
}) {
  if (appearance?.emoji) {
    return <span className="sidebar-folder-emoji">{appearance.emoji}</span>;
  }
  const Icon = isRootFolder(folder) ? FolderOpen : Folder;
  return <Icon strokeWidth={1.8} />;
}

function FolderNavItem({
  folder,
  label,
  count,
  active,
  collapsed,
  appearance,
  onSelect,
  onCustomize,
  onContextMenu,
}: {
  folder: string;
  label: string;
  count: number;
  active: boolean;
  collapsed: boolean;
  appearance?: FolderAppearance;
  onSelect: () => void;
  onCustomize: () => void;
  onContextMenu: (event: MouseEvent) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        "sidebar-nav-item sidebar-folder-item grid w-full items-center gap-1 rounded-lg px-2.5",
        collapsed
          ? "min-[761px]:grid-cols-1 min-[761px]:justify-items-center min-[761px]:gap-0 min-[761px]:px-0"
          : "grid-cols-[minmax(0,1fr)_auto]",
        active && "is-active",
      )}
      data-folder-color={appearance?.color}
    >
      <button
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        className={cn(
          "sidebar-nav-main grid min-w-0 items-center gap-2 text-left",
          collapsed
            ? "min-[761px]:grid-cols-1 min-[761px]:justify-items-center"
            : "grid-cols-[16px_minmax(0,1fr)]",
        )}
        onClick={onSelect}
        onContextMenu={onContextMenu}
        title={label}
        type="button"
      >
        <span className="sidebar-nav-icon" aria-hidden="true">
          <FolderGlyph appearance={appearance} folder={folder} />
        </span>
        <span className={cn("truncate", collapsed && "min-[761px]:hidden")}>{label}</span>
      </button>
      {!collapsed && (
        <>
          <button
            aria-label={t("folder.customize")}
            className="sidebar-folder-customize"
            onClick={onCustomize}
            title={t("folder.customize")}
            type="button"
          >
            <SmilePlus />
          </button>
          <span className="sidebar-nav-count tabular-nums">{count}</span>
        </>
      )}
    </div>
  );
}

export function LibrarySidebar({
  isDark,
  onCreateFolder,
  onCreateTag,
  className,
}: {
  isDark: boolean;
  onCreateFolder: () => void;
  onCreateTag: () => void;
  className?: string;
}) {
  const notes = useAppStore((state) => state.notes);
  const attachments = useAppStore((state) => state.attachments);
  const navFilter = useAppStore((state) => state.navFilter);
  const scopedFilter = useAppStore((state) => state.scopedFilter);
  const libraryPanelMode = useAppStore((state) => state.libraryPanelMode);
  const collapsed = useAppStore((state) => state.isSidebarCollapsed);
  const folderAppearances = useAppStore((state) => state.folderAppearances);
  const setCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const setNavFilter = useAppStore((state) => state.setNavFilter);
  const setScopedFilter = useAppStore((state) => state.setScopedFilter);
  const setLibraryPanelMode = useAppStore((state) => state.setLibraryPanelMode);
  const setFolderAppearance = useAppStore((state) => state.setFolderAppearance);
  const setSettings = useAppStore((state) => state.setSettings);
  const settings = useAppStore((state) => state.settings);
  const openSettings = useAppStore((state) => state.openSettings);
  const { t, locale } = useI18n();
  const compareLocale = dateLocale(locale);
  const folders = uniqueSorted(
    notes.map((note) => folderName(note.relativePath)),
    compareLocale,
  );
  const tags = uniqueSorted(notes.flatMap((note) => note.tags), compareLocale);
  const [menuTarget, setMenuTarget] = useState<FolderMenuTarget | null>(null);
  const [appearanceFolder, setAppearanceFolder] = useState<string | null>(null);

  const folderLabel = (folder: string) =>
    isRootFolder(folder) ? t("library.rootFolder") : folder;

  return (
    <aside
      className={cn(
        "library-sidebar flex min-h-0 flex-col border-r border-border bg-panel max-[760px]:border-r-0",
        collapsed && "min-[761px]:w-[52px] min-[761px]:overflow-hidden",
        className,
      )}
    >
      <header
        className={cn(
          "sidebar-titlebar flex h-12 shrink-0 items-center justify-between px-3",
          isTauriRuntime() && "min-[761px]:pl-[70px]",
          collapsed && "min-[761px]:justify-center min-[761px]:px-0",
        )}
        data-tauri-drag-region={isTauriRuntime() ? "" : undefined}
        onMouseDown={handleWindowDragMouseDown}
      >
        {!isTauriRuntime() && (
          <div
            className={cn(
              "pointer-events-none flex min-w-0 items-center gap-2",
              collapsed && "min-[761px]:hidden",
            )}
          >
            <div className="memoir-logo grid h-6 w-6 shrink-0 place-items-center rounded-[7px] text-[11px] font-black">
              M
            </div>
            <span className="truncate text-[14px] font-semibold tracking-[-0.02em] text-text">
              Memoir
            </span>
          </div>
        )}
        <IconButton
          className={cn(
            "h-8 w-8 shrink-0 self-start",
            isTauriRuntime() && "mt-[7px]",
            collapsed ? "min-[761px]:mx-auto" : "ml-auto",
          )}
          label={collapsed ? t("nav.expand") : t("nav.collapse")}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <nav className="grid gap-1 px-2.5 pb-2 pt-2">
          <NavButton
            active={libraryPanelMode !== "attachments" && navFilter === "all" && !scopedFilter}
            collapsed={collapsed}
            count={notes.length}
            icon={<FileText strokeWidth={1.8} />}
            label={t("nav.allNotes")}
            onClick={() => setNavFilter("all")}
          />
          <NavButton
            active={libraryPanelMode !== "attachments" && navFilter === "recent"}
            collapsed={collapsed}
            count={notes.filter((note) => Date.now() - note.modifiedMs <= 7 * 86_400_000).length}
            icon={<Clock3 strokeWidth={1.8} />}
            label={t("nav.recent")}
            onClick={() => setNavFilter("recent")}
          />
          <NavButton
            active={libraryPanelMode !== "attachments" && navFilter === "favorites"}
            collapsed={collapsed}
            count={notes.filter((note) => note.favorite).length}
            icon={<Star strokeWidth={1.8} />}
            label={t("nav.favorites")}
            onClick={() => setNavFilter("favorites")}
          />
          <NavButton
            active={libraryPanelMode !== "attachments" && navFilter === "uncategorized"}
            collapsed={collapsed}
            count={notes.filter((note) => note.tags.length === 0).length}
            icon={<Inbox strokeWidth={1.8} />}
            label={t("nav.uncategorized")}
            onClick={() => setNavFilter("uncategorized")}
          />
          <NavButton
            active={libraryPanelMode === "attachments"}
            collapsed={collapsed}
            count={attachments.length}
            icon={<Paperclip strokeWidth={1.8} />}
            label={t("nav.attachments")}
            onClick={() => setLibraryPanelMode("attachments")}
          />
        </nav>

        <section className="sidebar-group px-2.5 pb-2 pt-2.5">
          {!collapsed && (
            <div className="sidebar-section-title mb-1 flex h-7 items-center justify-between px-2.5 font-medium text-muted">
              <span>{t("nav.folders")}</span>
            <button aria-label={t("nav.newFolder")} onClick={onCreateFolder} type="button">
              +
            </button>
            </div>
          )}
          {folders.slice(0, 8).map((folder) => (
            <FolderNavItem
              active={
                libraryPanelMode !== "attachments" &&
                scopedFilter?.type === "folder" &&
                scopedFilter.value === folder
              }
              appearance={folderAppearances[folder]}
              collapsed={collapsed}
              count={notes.filter((note) => folderName(note.relativePath) === folder).length}
              folder={folder}
              key={folder || "__root__"}
              label={folderLabel(folder)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenuTarget({
                  x: event.clientX,
                  y: event.clientY,
                  folder,
                  label: folderLabel(folder),
                });
              }}
              onCustomize={() => setAppearanceFolder(folder)}
              onSelect={() => setScopedFilter({ type: "folder", value: folder })}
            />
          ))}
        </section>

        <section className="sidebar-group px-2.5 pb-2 pt-2.5">
          {!collapsed && (
            <div className="sidebar-section-title mb-1 flex h-7 items-center justify-between px-2.5 font-medium text-muted">
              <span>{t("nav.tags")}</span>
            <button aria-label={t("nav.newTag")} onClick={onCreateTag} type="button">
              +
            </button>
            </div>
          )}
          {tags.slice(0, 8).map((tag) => (
            <NavButton
              active={
                libraryPanelMode !== "attachments" &&
                scopedFilter?.type === "tag" &&
                normalizeTag(scopedFilter.value) === normalizeTag(tag)
              }
              collapsed={collapsed}
              count={
                notes.filter((note) =>
                  note.tags.some((noteTag) => normalizeTag(noteTag) === normalizeTag(tag)),
                ).length
              }
              icon={<TagIcon strokeWidth={1.8} />}
              key={tag}
              label={tag}
              onClick={() => setScopedFilter({ type: "tag", value: tag })}
            />
          ))}
        </section>
      </div>

      <footer
        className={cn(
          "sidebar-footer flex shrink-0 items-center gap-1.5 p-1.5",
          collapsed && "min-[761px]:flex-col min-[761px]:gap-1 min-[761px]:py-2",
        )}
      >
        <WorkspaceSwitcher collapsed={collapsed} noteCount={notes.length} />
        <div
          className={cn(
            "flex shrink-0 gap-0.5",
            collapsed && "min-[761px]:flex-col",
          )}
        >
          <IconButton
            className="h-7 w-7"
            label={isDark ? t("nav.switchToLight") : t("nav.switchToDark")}
            onClick={() =>
              setSettings({
                ...settings,
                appearance: {
                  ...settings.appearance,
                  theme: isDark ? "light" : "dark",
                },
              })
            }
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </IconButton>
          <IconButton className="h-7 w-7" label={t("common.settings")} onClick={() => openSettings()}>
            <Settings className="h-4 w-4" />
          </IconButton>
        </div>
      </footer>

      <FolderContextMenu
        onClose={() => setMenuTarget(null)}
        onCustomize={(folder) => setAppearanceFolder(folder)}
        onOpen={(folder) => setScopedFilter({ type: "folder", value: folder })}
        target={menuTarget}
      />
      <FolderAppearanceDialog
        appearance={
          appearanceFolder === null ? undefined : folderAppearances[appearanceFolder]
        }
        folder={appearanceFolder ?? ""}
        folderLabel={appearanceFolder === null ? "" : folderLabel(appearanceFolder)}
        onChange={(appearance) => {
          if (appearanceFolder !== null) void setFolderAppearance(appearanceFolder, appearance);
        }}
        onClose={() => setAppearanceFolder(null)}
        open={appearanceFolder !== null}
      />
    </aside>
  );
}
