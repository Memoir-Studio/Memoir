import * as stylex from "@stylexjs/stylex";
import {
  ChevronRight,
  Clock3,
  Cloud,
  Database,
  FileText,
  Folder,
  FolderOpen,
  Moon,
  Network,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SmilePlus,
  Sparkles,
  Star,
  Sun,
  Tag as TagIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { IconButton } from "../../components/ui";
import {
  FOLDER_COLOR_HEX,
  buildFolderTree,
  expandFolderAncestors,
  type FolderAppearance,
  type FolderTreeNode,
} from "../../domain/folders";
import { isTauriRuntime } from "../../platform/runtime";
import { useAppStore } from "../../store/app-store";
import { handleWindowDragMouseDown } from "../window/window-drag";
import { useI18n } from "../../i18n/react";
import { dateLocale } from "../../i18n";
import { WorkspaceSwitcher } from "../workspace/WorkspaceSwitcher";
import { FolderAppearanceDialog } from "./FolderAppearanceDialog";
import { FolderContextMenu, type FolderMenuTarget } from "./FolderContextMenu";
import { isRootFolder, normalizeTag } from "./note-utils";
import { accents } from "../../styles/tokens.stylex";
import {
  folderRowMarker,
  sharedLibraryStyles,
  sidebarStyles,
} from "./library-styles.stylex";

function NavButton({
  label,
  count,
  active,
  collapsed,
  icon,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  collapsed: boolean;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      title={collapsed ? label : undefined}
      type="button"
      {...stylex.props(
        sidebarStyles.navItem,
        sidebarStyles.navLayout,
        collapsed && sidebarStyles.collapsedLayout,
        active && sidebarStyles.active,
      )}
    >
      <span aria-hidden="true" {...stylex.props(sidebarStyles.navIcon, active && sidebarStyles.navIconActive)}>
        {icon}
      </span>
      <span
        data-sidebar-nav-label=""
        {...stylex.props(sidebarStyles.navLabel, collapsed && sidebarStyles.collapsedHidden)}
      >
        {label}
      </span>
      {typeof count === "number" ? (
        <span
          {...stylex.props(
            sidebarStyles.navCount,
            active && sidebarStyles.navCountActive,
            collapsed && sidebarStyles.collapsedHidden,
          )}
        >
          {count}
        </span>
      ) : (
        <span {...stylex.props(collapsed && sidebarStyles.collapsedHidden)} />
      )}
    </button>
  );
}

function FolderGlyph({
  folder,
  appearance,
  color,
}: {
  folder: string;
  appearance?: FolderAppearance;
  color: string;
}) {
  if (appearance?.emoji) {
    return (
      <span
        {...stylex.props(
          sidebarStyles.folderEmoji,
          appearance.color && sidebarStyles.folderEmojiColored(color),
        )}
      >
        {appearance.emoji}
      </span>
    );
  }
  const Icon = isRootFolder(folder) ? FolderOpen : Folder;
  return <Icon strokeWidth={1.8} {...stylex.props(sidebarStyles.navSvg)} />;
}

function flattenFolderTree(
  roots: FolderTreeNode[],
  collapsedFolders: ReadonlySet<string>,
  sidebarCollapsed: boolean,
) {
  const visible: Array<{ node: FolderTreeNode; depth: number }> = [];
  const walk = (node: FolderTreeNode, depth: number) => {
    visible.push({ node, depth });
    if (sidebarCollapsed) return;
    if (!node.children.length || collapsedFolders.has(node.folder)) return;
    for (const child of node.children) walk(child, depth + 1);
  };
  for (const node of roots) walk(node, 0);
  return visible;
}

function FolderNavItem({
  folder,
  label,
  count,
  active,
  collapsed,
  depth,
  expanded,
  hasChildren,
  appearance,
  isDark,
  onSelect,
  onToggle,
  onCustomize,
  onContextMenu,
}: {
  folder: string;
  label: string;
  count: number;
  active: boolean;
  collapsed: boolean;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  appearance?: FolderAppearance;
  isDark: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onCustomize: () => void;
  onContextMenu: (event: MouseEvent) => void;
}) {
  const { t } = useI18n();
  const reservesToggleSlot = hasChildren || depth > 0;
  const folderColor = appearance?.color
    ? appearance.color === "ink"
      ? isDark
        ? "#efede7"
        : FOLDER_COLOR_HEX.ink
      : FOLDER_COLOR_HEX[appearance.color]
    : accents.primary;
  return (
    <div
      data-folder-color={appearance?.color}
      data-sidebar-folder-item=""
      {...stylex.props(
        folderRowMarker,
        sidebarStyles.navItem,
        sidebarStyles.folderRow,
        collapsed
          ? sidebarStyles.collapsedLayout
          : [
              sidebarStyles.folderTree(depth),
              reservesToggleSlot
                ? sidebarStyles.folderWithToggle
                : sidebarStyles.folderWithoutToggle,
            ],
        active && sidebarStyles.active,
        active && appearance?.color && sidebarStyles.folderActive(folderColor),
      )}
    >
      {!collapsed &&
        (hasChildren ? (
          <button
            aria-expanded={expanded}
            aria-label={expanded ? t("folder.collapse", { name: label }) : t("folder.expand", { name: label })}
            data-sidebar-folder-toggle=""
            onClick={onToggle}
            type="button"
            {...stylex.props(sidebarStyles.folderToggleSlot, sidebarStyles.folderToggle)}
          >
            <ChevronRight
              aria-hidden
              strokeWidth={2}
              {...stylex.props(sidebarStyles.chevron, expanded && sidebarStyles.chevronOpen)}
            />
          </button>
        ) : depth > 0 ? (
          <span aria-hidden data-sidebar-folder-toggle-spacer="" {...stylex.props(sidebarStyles.folderToggleSlot)} />
        ) : null)}
      <button
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        onClick={onSelect}
        onContextMenu={onContextMenu}
        title={folder || label}
        type="button"
        {...stylex.props(sidebarStyles.navMain, collapsed && sidebarStyles.navMainCollapsed)}
      >
        <span
          aria-hidden="true"
          {...stylex.props(
            sidebarStyles.navIcon,
            (active || appearance?.color) && sidebarStyles.folderIconColor(folderColor),
          )}
        >
          <FolderGlyph appearance={appearance} color={folderColor} folder={folder} />
        </span>
        <span
          data-sidebar-nav-label=""
          {...stylex.props(sidebarStyles.navLabel, collapsed && sidebarStyles.collapsedHidden)}
        >
          {label}
        </span>
      </button>
      {!collapsed && (
        <>
          <button
            aria-label={t("folder.customizeNamed", { name: label })}
            data-sidebar-folder-customize=""
            onClick={onCustomize}
            title={t("folder.customize")}
            type="button"
            {...stylex.props(sidebarStyles.customize)}
          >
            <SmilePlus {...stylex.props(sidebarStyles.customizeIcon)} />
          </button>
          <span {...stylex.props(sidebarStyles.navCount, active && sidebarStyles.navCountActive)}>{count}</span>
        </>
      )}
    </div>
  );
}

export function LibrarySidebar({
  isDark,
  onCreateFolder,
  onCreateNote = () => undefined,
  onCreateTag,
  onOpenAi,
  style,
}: {
  isDark: boolean;
  onCreateFolder: (parent?: string) => void;
  onCreateNote?: (folder: string) => void;
  onCreateTag: () => void;
  onOpenAi?: () => void;
  style?: stylex.StyleXStyles;
}) {
  const libraryStats = useAppStore((state) => state.libraryStats);
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
  const folderTree = useMemo(
    () => buildFolderTree(libraryStats.folders, compareLocale),
    [compareLocale, libraryStats.folders],
  );
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const tags = [...libraryStats.tags].sort((left, right) =>
    left.tag.localeCompare(right.tag, compareLocale),
  );
  const [menuTarget, setMenuTarget] = useState<FolderMenuTarget | null>(null);
  const [appearanceFolder, setAppearanceFolder] = useState<string | null>(null);

  useEffect(() => {
    if (scopedFilter?.type !== "folder") return;
    const ancestors = expandFolderAncestors(scopedFilter.value).filter(
      (folder) => folder !== scopedFilter.value,
    );
    setCollapsedFolders((current) => {
      let changed = false;
      const next = new Set(current);
      for (const ancestor of ancestors) {
        if (next.delete(ancestor)) changed = true;
      }
      return changed ? next : current;
    });
  }, [scopedFilter]);

  const visibleFolders = useMemo(
    () => flattenFolderTree(folderTree, collapsedFolders, collapsed),
    [collapsed, collapsedFolders, folderTree],
  );

  const folderLabel = (folder: string, name = folder) =>
    isRootFolder(folder) ? t("library.rootFolder") : name || folder;
  const notesNavActive =
    libraryPanelMode === "notes" || libraryPanelMode === "outline" || libraryPanelMode === "links";
  const toggleFolder = (folder: string) => {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  return (
    <aside
      data-library-sidebar=""
      {...stylex.props(sidebarStyles.sidebar, collapsed && sidebarStyles.sidebarCollapsed, style)}
    >
      <header
        data-tauri-drag-region={isTauriRuntime() ? "" : undefined}
        onMouseDown={handleWindowDragMouseDown}
        {...stylex.props(
          sidebarStyles.titlebar,
          isTauriRuntime() && sidebarStyles.titlebarTauri,
          collapsed && sidebarStyles.titlebarCollapsed,
        )}
      >
        {!isTauriRuntime() && (
          <div
            {...stylex.props(sidebarStyles.brand, collapsed && sidebarStyles.brandCollapsed)}
          >
            <div {...stylex.props(sidebarStyles.logo)}>M</div>
            <span {...stylex.props(sidebarStyles.brandName)}>Memoir</span>
          </div>
        )}
        <IconButton
          label={collapsed ? t("nav.expand") : t("nav.collapse")}
          onClick={() => setCollapsed(!collapsed)}
          style={[
            sidebarStyles.collapseButton,
            isTauriRuntime() && sidebarStyles.collapseButtonTauri,
            collapsed ? sidebarStyles.collapseButtonCentered : sidebarStyles.collapseButtonRight,
          ]}
        >
          {collapsed ? (
            <PanelLeftOpen {...stylex.props(sharedLibraryStyles.icon)} />
          ) : (
            <PanelLeftClose {...stylex.props(sharedLibraryStyles.icon)} />
          )}
        </IconButton>
      </header>

      <div {...stylex.props(sidebarStyles.scroller)}>
        <nav {...stylex.props(sidebarStyles.primaryNav)}>
          <NavButton
            active={notesNavActive && navFilter === "all" && !scopedFilter}
            collapsed={collapsed}
            count={libraryStats.total}
            icon={<FileText strokeWidth={1.8} {...stylex.props(sidebarStyles.navSvg)} />}
            label={t("nav.allNotes")}
            onClick={() => setNavFilter("all")}
          />
          <NavButton
            active={notesNavActive && navFilter === "recent"}
            collapsed={collapsed}
            count={libraryStats.recent}
            icon={<Clock3 strokeWidth={1.8} {...stylex.props(sidebarStyles.navSvg)} />}
            label={t("nav.recent")}
            onClick={() => setNavFilter("recent")}
          />
          <NavButton
            active={notesNavActive && navFilter === "favorites"}
            collapsed={collapsed}
            count={libraryStats.favorites}
            icon={<Star strokeWidth={1.8} {...stylex.props(sidebarStyles.navSvg)} />}
            label={t("nav.favorites")}
            onClick={() => setNavFilter("favorites")}
          />
          <NavButton
            active={libraryPanelMode === "graph"}
            collapsed={collapsed}
            icon={<Network strokeWidth={1.8} {...stylex.props(sidebarStyles.navSvg)} />}
            label={t("nav.graph")}
            onClick={() => setLibraryPanelMode("graph")}
          />
          <NavButton
            active={libraryPanelMode === "attachments"}
            collapsed={collapsed}
            count={attachments.length}
            icon={<Paperclip strokeWidth={1.8} {...stylex.props(sidebarStyles.navSvg)} />}
            label={t("nav.attachments")}
            onClick={() => setLibraryPanelMode("attachments")}
          />
          <NavButton
            active={libraryPanelMode === "index"}
            collapsed={collapsed}
            icon={<Database strokeWidth={1.8} {...stylex.props(sidebarStyles.navSvg)} />}
            label={t("nav.index")}
            onClick={() => setLibraryPanelMode("index")}
          />
          <NavButton
            active={libraryPanelMode === "ai"}
            collapsed={collapsed}
            icon={<Sparkles strokeWidth={1.8} {...stylex.props(sidebarStyles.navSvg)} />}
            label={t("nav.aiRewrite")}
            onClick={onOpenAi ?? (() => setLibraryPanelMode("ai"))}
          />
          <NavButton
            active={libraryPanelMode === "sync"}
            collapsed={collapsed}
            icon={<Cloud strokeWidth={1.8} {...stylex.props(sidebarStyles.navSvg)} />}
            label={t("nav.cloudSync")}
            onClick={() => setLibraryPanelMode("sync")}
          />
        </nav>

        <section {...stylex.props(sidebarStyles.group)}>
          {!collapsed && (
            <div {...stylex.props(sidebarStyles.sectionTitle)}>
              <span>{t("nav.folders")}</span>
              <button
                aria-label={t("nav.newFolder")}
                onClick={() => onCreateFolder("")}
                type="button"
                {...stylex.props(sidebarStyles.sectionAction)}
              >
                +
              </button>
            </div>
          )}
          {visibleFolders.map(({ node, depth }) => {
            const label = folderLabel(node.folder, node.name);
            return (
              <FolderNavItem
                active={
                  notesNavActive &&
                  scopedFilter?.type === "folder" &&
                  scopedFilter.value === node.folder
                }
                appearance={folderAppearances[node.folder]}
                collapsed={collapsed}
                count={node.count}
                depth={depth}
                expanded={!collapsedFolders.has(node.folder)}
                folder={node.folder}
                hasChildren={node.children.length > 0}
                isDark={isDark}
                key={node.folder || "__root__"}
                label={label}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenuTarget({
                    x: event.clientX,
                    y: event.clientY,
                    folder: node.folder,
                    label,
                  });
                }}
                onCustomize={() => setAppearanceFolder(node.folder)}
                onSelect={() => setScopedFilter({ type: "folder", value: node.folder })}
                onToggle={() => toggleFolder(node.folder)}
              />
            );
          })}
        </section>

        <section {...stylex.props(sidebarStyles.group)}>
          {!collapsed && (
            <div {...stylex.props(sidebarStyles.sectionTitle)}>
              <span>{t("nav.tags")}</span>
              <button
                aria-label={t("nav.newTag")}
                onClick={onCreateTag}
                type="button"
                {...stylex.props(sidebarStyles.sectionAction)}
              >
                +
              </button>
            </div>
          )}
          {tags.slice(0, 8).map((tag) => (
            <NavButton
              active={
                notesNavActive &&
                scopedFilter?.type === "tag" &&
                normalizeTag(scopedFilter.value) === tag.tagNorm
              }
              collapsed={collapsed}
              count={tag.count}
              icon={<TagIcon strokeWidth={1.8} {...stylex.props(sidebarStyles.navSvg)} />}
              key={tag.tagNorm}
              label={tag.tag}
              onClick={() => setScopedFilter({ type: "tag", value: tag.tag })}
            />
          ))}
        </section>
      </div>

      <footer
        {...stylex.props(sidebarStyles.footer, collapsed && sidebarStyles.footerCollapsed)}
      >
        <WorkspaceSwitcher collapsed={collapsed} noteCount={libraryStats.total} />
        <div
          {...stylex.props(
            sidebarStyles.footerActions,
            collapsed && sidebarStyles.footerActionsCollapsed,
          )}
        >
          <IconButton
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
            style={sidebarStyles.footerButton}
          >
            {isDark ? (
              <Sun {...stylex.props(sharedLibraryStyles.icon)} />
            ) : (
              <Moon {...stylex.props(sharedLibraryStyles.icon)} />
            )}
          </IconButton>
          <IconButton
            label={t("common.settings")}
            onClick={() => openSettings()}
            style={sidebarStyles.footerButton}
          >
            <Settings {...stylex.props(sharedLibraryStyles.icon)} />
          </IconButton>
        </div>
      </footer>

      <FolderContextMenu
        onClose={() => setMenuTarget(null)}
        onCreate={(folder) => {
          setCollapsedFolders((current) => {
            if (!folder || !current.has(folder)) return current;
            const next = new Set(current);
            next.delete(folder);
            return next;
          });
          onCreateFolder(folder);
        }}
        onCreateNote={onCreateNote}
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
        isDark={isDark}
        onChange={(appearance) => {
          if (appearanceFolder !== null) void setFolderAppearance(appearanceFolder, appearance);
        }}
        onClose={() => setAppearanceFolder(null)}
        open={appearanceFolder !== null}
      />
    </aside>
  );
}
