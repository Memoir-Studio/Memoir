import { FolderOpen, Library, Menu, Pencil } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Button, StatusNotice } from "../components/ui";
import { LibrarySidebar } from "../features/library/LibrarySidebar";
import { NoteList } from "../features/library/NoteList";
import { WindowChrome } from "../features/window/WindowChrome";
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
import { applyWindowFrameState, watchWindowFrameState } from "../platform/window";
import { useAppStore } from "../store/app-store";

const SettingsDialog = lazy(() => import("../features/settings/SettingsDialog"));
const EditorWorkspace = lazy(() => import("../features/editor/EditorWorkspace"));

function EmptyState() {
  const openWorkspace = useAppStore((state) => state.openWorkspace);
  const { t } = useI18n();
  return (
    <div className="memoir-window-frame">
      <section className="workspace-shell grid place-items-center px-6">
        <div className="max-w-lg text-center">
          <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-xl bg-accent text-accent-contrast">
            M
          </div>
          <h1 className="text-2xl font-extrabold text-text">Memoir</h1>
          <p className="mt-3 text-sm leading-7 text-muted">{t("app.emptyDescription")}</p>
          <Button className="mt-6" onClick={() => void openWorkspace()} variant="primary">
            <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.8} />
            {isTauriRuntime() ? t("app.openFolder") : t("app.loadDemo")}
          </Button>
        </div>
      </section>
    </div>
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
  const { openCreate, openDelete, openRename } = useWorkspaceDialogs();
  const { t } = useI18n();
  const panelClass = (panel: "navigation" | "library" | "editor") =>
    mobilePanel === panel
      ? "max-[760px]:fixed max-[760px]:bottom-0 max-[760px]:left-0 max-[760px]:top-12 max-[760px]:z-20 max-[760px]:flex max-[760px]:w-[min(86vw,320px)] max-[760px]:shadow-2xl"
      : "max-[760px]:hidden";

  return (
    <div className="memoir-window-frame">
      <WindowChrome controlsHidden={isSidebarCollapsed} />
      <main
        className={`workspace-shell relative grid min-h-0 grid-rows-[minmax(0,1fr)] text-text ${
          isSidebarCollapsed
            ? "grid-cols-[52px_280px_minmax(0,1fr)]"
            : "grid-cols-[164px_280px_minmax(0,1fr)]"
        } ${
          isSidebarCollapsed
            ? "min-[761px]:max-[980px]:grid-cols-[52px_256px_minmax(0,1fr)]"
            : "min-[761px]:max-[980px]:grid-cols-[164px_256px_minmax(0,1fr)]"
        } max-[760px]:block max-[760px]:h-auto max-[760px]:min-h-screen max-[760px]:pt-12`}
        data-background={settings.appearance.background}
        data-density={settings.appearance.density}
      >
        <LibrarySidebar
          className={panelClass("navigation")}
          isDark={isDark}
          onCreateFolder={() => openCreate("mdx", t("create.newFolder"))}
          onCreateTag={() => openCreate("mdx", "", t("create.newTag"))}
        />
        <NoteList
          className={panelClass("library")}
          onCreate={() => openCreate()}
          onDelete={openDelete}
          onRename={openRename}
        />
        <Suspense
          fallback={
            <section className="grid min-h-0 min-w-0 place-items-center bg-canvas text-sm text-muted">
              {t("app.loadingWorkspace")}
            </section>
          }
        >
          <EditorWorkspace
            className="max-[760px]:grid max-[760px]:min-h-[calc(100vh-48px)]"
            isDark={isDark}
            onDelete={openDelete}
            onRename={openRename}
          />
        </Suspense>

        {mobilePanel !== "editor" && (
          <button
            aria-label={t("app.closeDrawer")}
            className="fixed inset-0 top-12 z-10 hidden bg-text/20 max-[760px]:block"
            onClick={() => setMobilePanel("editor")}
            type="button"
          />
        )}
        <nav className="mobile-tabs fixed inset-x-0 top-0 z-30 hidden h-12 border-b border-border bg-elevated max-[760px]:grid max-[760px]:grid-cols-3">
          <button
            aria-pressed={mobilePanel === "navigation"}
            className="flex items-center justify-center gap-1.5 text-xs text-muted transition-colors duration-150 aria-pressed:bg-panel aria-pressed:text-text"
            onClick={() => setMobilePanel("navigation")}
            type="button"
          >
            <Menu className="h-4 w-4" />
            {t("nav.navigation")}
          </button>
          <button
            aria-pressed={mobilePanel === "library"}
            className="flex items-center justify-center gap-1.5 text-xs text-muted transition-colors duration-150 aria-pressed:bg-panel aria-pressed:text-text"
            onClick={() => setMobilePanel("library")}
            type="button"
          >
            <Library className="h-4 w-4" />
            {t("nav.notes")}
          </button>
          <button
            aria-pressed={mobilePanel === "editor"}
            className="flex items-center justify-center gap-1.5 text-xs text-muted transition-colors duration-150 aria-pressed:bg-panel aria-pressed:text-text"
            onClick={() => setMobilePanel("editor")}
            type="button"
          >
            <Pencil className="h-4 w-4" />
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
    </div>
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
    root.style.setProperty("--memoir-body-size", `${settings.appearance.bodyFontSize}px`);
    root.style.setProperty("--memoir-line-height", String(settings.appearance.lineHeight));
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
    </I18nProvider>
  );
}

function LoadingScreen() {
  const { t } = useI18n();
  return (
    <div className="memoir-window-frame">
      <div className="workspace-shell grid place-items-center text-sm text-muted">{t("app.loading")}</div>
    </div>
  );
}
