import * as stylex from "@stylexjs/stylex";
import { FolderOpen, Library, Menu, Pencil } from "lucide-react";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, StatusNotice } from "../components/ui";
import {
  COLLAPSED_SIDEBAR_WIDTH,
  DEFAULT_LIBRARY_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_LIBRARY_WIDTH,
  MAX_SIDEBAR_WIDTH,
  MIN_EDITOR_WIDTH,
  MIN_LIBRARY_WIDTH,
  MIN_SIDEBAR_WIDTH,
  fitLayoutColumns,
} from "../domain/layout";
import type { EditorHandle } from "../features/editor/EditorPane";
import { LayoutResizeHandle } from "../features/layout/LayoutResizeHandle";
import { LibrarySidebar } from "../features/library/LibrarySidebar";
import { NoteList } from "../features/library/NoteList";
import { AppUpdateNotice } from "../features/update/AppUpdateNotice";
import { WindowFrame } from "../features/window/WindowChrome";
import {
  useWorkspaceDialogs,
  WorkspaceDialogsProvider,
} from "../features/workspace/WorkspaceDialogs";
import { getGateways } from "../gateways";
import { htmlLang, resolveLocale } from "../i18n";
import { I18nProvider, useI18n } from "../i18n/react";
import { migrateLegacyStorage } from "../migrations/legacy-storage";
import { applyInterfaceZoom, watchSystemScale } from "../platform/dpi";
import { installNativeContextMenuBlock } from "../platform/native-context-menu";
import { isTauriRuntime } from "../platform/runtime";
import { applyHostWindowChrome, applyWindowFrameState, watchWindowFrameState } from "../platform/window";
import { useAppStore } from "../store/app-store";
import { applyDocumentTheme } from "../styles/document-theme";
import { accents, colors, media, motion } from "../styles/tokens.stylex";

const SettingsDialog = lazy(() => import("../features/settings/SettingsDialog"));
const EditorWorkspace = lazy(() => import("../features/editor/EditorWorkspace"));
const NoteGraphView = lazy(() => import("../features/graph/NoteGraphView"));

function EmptyState() {
  const openWorkspace = useAppStore((state) => state.openWorkspace);
  const { t } = useI18n();
  return (
    <WindowFrame surfaceDrag>
      <section data-workspace-shell="" {...stylex.props(styles.workspaceShell, styles.centeredShell)}>
        <div {...stylex.props(styles.emptyContent)}>
          <div {...stylex.props(styles.logo)}>
            M
          </div>
          <h1 {...stylex.props(styles.emptyTitle)}>Memoir</h1>
          <p {...stylex.props(styles.emptyDescription)}>{t("app.emptyDescription")}</p>
          <div {...stylex.props(styles.emptyAction)}>
            <Button onClick={() => void openWorkspace()} variant="primary">
              <FolderOpen {...stylex.props(styles.smallIcon)} strokeWidth={1.8} />
              {isTauriRuntime() ? t("app.openFolder") : t("app.loadDemo")}
            </Button>
          </div>
        </div>
      </section>
    </WindowFrame>
  );
}

function WorkspaceLayout({
  isDark,
  migrationError,
  onDismissMigrationError,
}: {
  isDark: boolean;
  migrationError: string;
  onDismissMigrationError: () => void;
}) {
  const isSidebarCollapsed = useAppStore((state) => state.isSidebarCollapsed);
  const layout = useAppStore((state) => state.layout);
  const setLayout = useAppStore((state) => state.setLayout);
  const settings = useAppStore((state) => state.settings);
  const error = useAppStore((state) => state.error);
  const clearError = useAppStore((state) => state.clearError);
  const settingsOpen = useAppStore((state) => state.settingsOpen);
  const settingsSection = useAppStore((state) => state.settingsSection);
  const closeSettings = useAppStore((state) => state.closeSettings);
  const setSettings = useAppStore((state) => state.setSettings);
  const resetSettings = useAppStore((state) => state.resetSettings);
  const setSettingsSection = useAppStore((state) => state.setSettingsSection);
  const mobilePanel = useAppStore((state) => state.mobilePanel);
  const setMobilePanel = useAppStore((state) => state.setMobilePanel);
  const libraryPanelMode = useAppStore((state) => state.libraryPanelMode);
  const { openCreate, openDelete, openRename } = useWorkspaceDialogs();
  const { t } = useI18n();
  const editorRef = useRef<EditorHandle>(null);
  const shellRef = useRef<HTMLElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const columns = fitLayoutColumns({
    sidebarWidth: layout.sidebarWidth,
    libraryWidth: layout.libraryWidth,
    collapsed: isSidebarCollapsed,
    containerWidth,
  });
  const sidebarDragMax =
    containerWidth > 0
      ? Math.min(
          MAX_SIDEBAR_WIDTH,
          Math.max(MIN_SIDEBAR_WIDTH, containerWidth - columns.library - MIN_EDITOR_WIDTH),
        )
      : MAX_SIDEBAR_WIDTH;
  const libraryDragMax =
    containerWidth > 0
      ? Math.min(
          MAX_LIBRARY_WIDTH,
          Math.max(
            MIN_LIBRARY_WIDTH,
            containerWidth -
              (isSidebarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : columns.sidebar) -
              MIN_EDITOR_WIDTH,
          ),
        )
      : MAX_LIBRARY_WIDTH;

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell || typeof ResizeObserver === "undefined") return;
    const update = () => setContainerWidth(shell.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);

  return (
    <WindowFrame controlsHidden={isSidebarCollapsed}>
      <main
        data-background={settings.appearance.background}
        data-density={settings.appearance.density}
        data-workspace-shell=""
        ref={shellRef}
        {...stylex.props(
          styles.workspaceShell,
          styles.workspaceLayout,
          styles.workspaceColumns(
            `${columns.sidebar}px ${columns.library}px minmax(0, 1fr)`,
          ),
        )}
      >
        <div
          {...stylex.props(
            styles.panelSlot,
            mobilePanel === "navigation" && styles.mobilePanelActive,
          )}
        >
          <LibrarySidebar
            isDark={isDark}
            onCreateFolder={() => openCreate()}
            onCreateTag={() => openCreate("mdx", "", t("create.newTag"))}
          />
          {!isSidebarCollapsed && (
            <LayoutResizeHandle
              defaultValue={DEFAULT_SIDEBAR_WIDTH}
              label={t("layout.resizeSidebar")}
              max={sidebarDragMax}
              min={Math.min(MIN_SIDEBAR_WIDTH, columns.sidebar)}
              onChange={(sidebarWidth) => setLayout({ sidebarWidth })}
              value={columns.sidebar}
            />
          )}
        </div>
        <div
          {...stylex.props(
            styles.panelSlot,
            mobilePanel === "library" && styles.mobilePanelActive,
          )}
        >
          <NoteList
            onCreate={() => openCreate()}
            onDelete={openDelete}
            onInsertAttachment={(markdown) => editorRef.current?.insertText(markdown)}
            onRename={openRename}
          />
          <LayoutResizeHandle
            defaultValue={DEFAULT_LIBRARY_WIDTH}
            label={t("layout.resizeLibrary")}
            max={libraryDragMax}
            min={Math.min(MIN_LIBRARY_WIDTH, columns.library)}
            onChange={(libraryWidth) => setLayout({ libraryWidth })}
            value={columns.library}
          />
        </div>
        <Suspense
          fallback={
            <section {...stylex.props(styles.workspaceFallback)}>
              {t("app.loadingWorkspace")}
            </section>
          }
        >
          {libraryPanelMode === "graph" ? (
            <NoteGraphView />
          ) : (
            <EditorWorkspace
              isDark={isDark}
              onDelete={openDelete}
              onRename={openRename}
              ref={editorRef}
            />
          )}
        </Suspense>

        {mobilePanel !== "editor" && (
          <button
            aria-label={t("app.closeDrawer")}
            onClick={() => setMobilePanel("editor")}
            type="button"
            {...stylex.props(styles.drawerOverlay)}
          />
        )}
        <nav data-mobile-tabs="" {...stylex.props(styles.mobileTabs)}>
          <button
            aria-pressed={mobilePanel === "navigation"}
            onClick={() => setMobilePanel("navigation")}
            type="button"
            {...stylex.props(styles.mobileTab, mobilePanel === "navigation" && styles.mobileTabActive)}
          >
            <Menu {...stylex.props(styles.icon)} />
            {t("nav.navigation")}
          </button>
          <button
            aria-pressed={mobilePanel === "library"}
            onClick={() => setMobilePanel("library")}
            type="button"
            {...stylex.props(styles.mobileTab, mobilePanel === "library" && styles.mobileTabActive)}
          >
            <Library {...stylex.props(styles.icon)} />
            {t("nav.notes")}
          </button>
          <button
            aria-pressed={mobilePanel === "editor"}
            onClick={() => setMobilePanel("editor")}
            type="button"
            {...stylex.props(styles.mobileTab, mobilePanel === "editor" && styles.mobileTabActive)}
          >
            <Pencil {...stylex.props(styles.icon)} />
            {t("nav.editor")}
          </button>
        </nav>

        {error && (
          <StatusNotice danger onDismiss={clearError}>
            {error}
          </StatusNotice>
        )}
        {migrationError && !error && (
          <StatusNotice danger onDismiss={onDismissMigrationError}>
            {t("app.migrationFailed", { message: migrationError })}
          </StatusNotice>
        )}

        <Suspense fallback={null}>
          <SettingsDialog
            onClose={closeSettings}
            onReset={resetSettings}
            onSectionChange={setSettingsSection}
            onSettingsChange={setSettings}
            open={settingsOpen}
            section={settingsSection}
            settings={settings}
          />
        </Suspense>
      </main>
    </WindowFrame>
  );
}

export default function AppShell() {
  const initialized = useAppStore((state) => state.initialized);
  const initialize = useAppStore((state) => state.initialize);
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const settings = useAppStore((state) => state.settings);
  const [systemLanguage, setSystemLanguage] = useState(() => navigator.language);
  const locale = resolveLocale(settings.appearance.locale, systemLanguage);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [migrationError, setMigrationError] = useState("");
  const isDark =
    settings.appearance.theme === "dark" ||
    (settings.appearance.theme === "system" && systemDark);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onLanguageChange = () => setSystemLanguage(navigator.language);
    window.addEventListener("languagechange", onLanguageChange);
    return () => window.removeEventListener("languagechange", onLanguageChange);
  }, []);

  useEffect(() => {
    document.documentElement.lang = htmlLang(locale);
  }, [locale]);

  useEffect(() => {
    if (!initialized) return;
    const medium = window.matchMedia("(min-width: 761px) and (max-width: 980px)");
    const collapseAtMediumWidth = (matches: boolean) => {
      if (matches) useAppStore.getState().setSidebarCollapsed(true);
    };
    collapseAtMediumWidth(medium.matches);
    const onChange = (event: MediaQueryListEvent) => collapseAtMediumWidth(event.matches);
    medium.addEventListener("change", onChange);
    return () => medium.removeEventListener("change", onChange);
  }, [initialized]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = isDark ? "dark" : "light";
    root.dataset.accent = settings.appearance.accent;
    root.dataset.background = settings.appearance.background;
    root.dataset.density = settings.appearance.density;
    root.dataset.bodyFont = settings.appearance.bodyFont;
    root.dataset.contentWidth = settings.appearance.contentWidth;
    applyDocumentTheme(settings.appearance, isDark, root);
  }, [isDark, settings.appearance]);

  useEffect(() => {
    void applyInterfaceZoom(settings.appearance.uiScale);
  }, [settings.appearance.uiScale]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void watchSystemScale((systemScale) => {
      void applyInterfaceZoom(useAppStore.getState().settings.appearance.uiScale, systemScale);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useLayoutEffect(() => {
    applyHostWindowChrome();
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void watchWindowFrameState((expanded) => {
      if (!disposed) applyWindowFrameState(expanded);
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
      applyWindowFrameState(false);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    migrateLegacyStorage(getGateways().persistence)
      .catch((migrationError) => {
        if (!cancelled) {
          setMigrationError(
            migrationError instanceof Error ? migrationError.message : String(migrationError),
          );
        }
      })
      .finally(() => {
        if (!cancelled) void initialize();
      });
    return () => {
      cancelled = true;
    };
  }, [initialize]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void useAppStore.getState().saveActiveNote();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const disposeContextMenu = installNativeContextMenuBlock();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      disposeContextMenu();
    };
  }, []);

  return (
    <I18nProvider locale={locale}>
      {!initialized ? (
        <LoadingScreen />
      ) : !workspaceRoot ? (
        <EmptyState />
      ) : (
        <WorkspaceDialogsProvider>
          <WorkspaceLayout
            isDark={isDark}
            migrationError={migrationError}
            onDismissMigrationError={() => setMigrationError("")}
          />
        </WorkspaceDialogsProvider>
      )}
      {initialized ? <AppUpdateNotice /> : null}
    </I18nProvider>
  );
}

function LoadingScreen() {
  const { t } = useI18n();
  return (
    <WindowFrame surfaceDrag>
      <div data-workspace-shell="" {...stylex.props(styles.workspaceShell, styles.loadingShell)}>
        {t("app.loading")}
      </div>
    </WindowFrame>
  );
}

const styles = stylex.create({
  workspaceShell: {
    boxSizing: "border-box",
    height: {
      default: "100%",
      [media.mobile]: "auto",
    },
    minHeight: {
      [media.mobile]: "100%",
    },
    overflow: "clip",
    borderWidth: {
      default: 1,
      [stylex.when.ancestor('[data-maximized="true"]')]: 0,
      [stylex.when.ancestor('[data-window-frame="flush"]')]: 0,
      [stylex.when.ancestor('[data-window-frame="native"]')]: 0,
      [media.mobile]: 0,
    },
    borderStyle: "solid",
    borderColor: {
      default: `color-mix(in srgb, ${colors.text} 8%, ${colors.border})`,
      [stylex.when.ancestor('[data-theme="dark"]')]: `color-mix(in srgb, ${colors.border} 55%, #000)`,
    },
    borderRadius: {
      default: 16,
      [stylex.when.ancestor('[data-maximized="true"]')]: 0,
      [stylex.when.ancestor('[data-window-frame="flush"]')]: 0,
      [stylex.when.ancestor('[data-window-frame="native"]')]: 10,
      [stylex.when.ancestor('[data-maximized="true"][data-window-frame="native"]')]: 0,
      [media.mobile]: 0,
    },
    backgroundColor: colors.canvas,
    boxShadow: {
      default:
        "0 1px 2px rgb(48 42 34 / 5%), 0 3px 8px -2px rgb(48 42 34 / 6%), inset 0 1px rgb(255 255 255 / 50%)",
      [stylex.when.ancestor('[data-theme="dark"]')]:
        "0 1px 2px rgb(0 0 0 / 16%), 0 4px 10px -2px rgb(0 0 0 / 14%), inset 0 1px rgb(255 255 255 / 5%)",
      [stylex.when.ancestor('[data-maximized="true"]')]: "none",
      [stylex.when.ancestor('[data-window-frame="flush"]')]: "none",
      [stylex.when.ancestor('[data-window-frame="native"]')]: "none",
      [media.mobile]: "none",
    },
    transitionProperty: "grid-template-columns",
    transitionDuration: {
      default: "200ms",
      [stylex.when.ancestor('[data-layout-resizing="true"]')]: "0s",
      [media.reducedMotion]: "0s",
      [media.mobile]: "0s",
    },
    transitionTimingFunction: motion.ease,
  },
  centeredShell: {
    display: "grid",
    placeItems: "center",
    paddingInline: 24,
  },
  emptyContent: {
    width: "100%",
    maxWidth: 512,
    textAlign: "center",
  },
  logo: {
    display: "grid",
    placeItems: "center",
    width: 48,
    height: 48,
    marginInline: "auto",
    marginBottom: 20,
    color: "#fffaf4",
    backgroundColor: accents.primary,
    backgroundImage:
      "radial-gradient(circle at 28% 28%, #f3957f 0 12%, transparent 13%), linear-gradient(145deg, #343532 0 46%, #d65f4d 47% 100%)",
    borderRadius: 8,
    boxShadow:
      "inset 0 0 0 1px rgb(255 255 255 / 12%), 0 2px 6px rgb(56 47 38 / 18%)",
  },
  emptyTitle: {
    margin: 0,
    color: colors.text,
    fontSize: 24,
    fontWeight: 800,
    lineHeight: 1.25,
    letterSpacing: 0,
  },
  emptyDescription: {
    marginTop: 12,
    marginBottom: 0,
    color: colors.muted,
    fontSize: 14,
    lineHeight: "28px",
  },
  emptyAction: {
    display: "flex",
    justifyContent: "center",
    marginTop: 24,
  },
  workspaceLayout: {
    position: "relative",
    display: {
      default: "grid",
      [media.mobile]: "block",
    },
    minWidth: 0,
    minHeight: {
      default: 0,
      [media.mobile]: "100vh",
    },
    gridTemplateRows: "minmax(0, 1fr)",
    paddingTop: {
      default: 0,
      [media.mobile]: 48,
    },
    color: colors.text,
  },
  workspaceColumns: (gridTemplateColumns: string) => ({
    gridTemplateColumns,
  }),
  panelSlot: {
    position: {
      default: "relative",
      [media.mobile]: "fixed",
    },
    top: {
      [media.mobile]: 48,
    },
    bottom: {
      [media.mobile]: 0,
    },
    left: {
      [media.mobile]: 0,
    },
    zIndex: {
      [media.mobile]: 20,
    },
    display: {
      default: "block",
      [media.mobile]: "none",
    },
    width: {
      default: "auto",
      [media.mobile]: "min(86vw, 320px)",
    },
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    boxShadow: {
      [media.mobile]: "0 25px 50px -12px rgb(0 0 0 / 25%)",
    },
  },
  mobilePanelActive: {
    display: {
      [media.mobile]: "flex",
    },
  },
  workspaceFallback: {
    display: "grid",
    minWidth: 0,
    minHeight: 0,
    placeItems: "center",
    color: colors.muted,
    backgroundColor: colors.canvas,
    fontSize: 14,
  },
  drawerOverlay: {
    position: "fixed",
    insetInline: 0,
    top: 48,
    bottom: 0,
    zIndex: 10,
    display: {
      default: "none",
      [media.mobile]: "block",
    },
    borderWidth: 0,
    backgroundColor: `color-mix(in srgb, ${colors.text} 20%, transparent)`,
  },
  mobileTabs: {
    position: "fixed",
    insetInline: 0,
    top: 0,
    zIndex: 30,
    display: {
      default: "none",
      [media.mobile]: "grid",
    },
    height: 48,
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    backgroundColor: colors.elevated,
  },
  mobileTab: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 0,
    color: colors.muted,
    backgroundColor: "transparent",
    fontSize: 12,
    transitionProperty: "color, background-color",
    transitionDuration: {
      default: "150ms",
      [media.reducedMotion]: "0s",
    },
  },
  mobileTabActive: {
    color: colors.text,
    backgroundColor: colors.panel,
  },
  icon: {
    width: 16,
    height: 16,
    flexShrink: 0,
  },
  smallIcon: {
    width: 14,
    height: 14,
    flexShrink: 0,
  },
  loadingShell: {
    display: "grid",
    placeItems: "center",
    color: colors.muted,
    fontSize: 14,
  },
});
