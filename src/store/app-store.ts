// Library refresh rules — do not put a full reconcile back on mutate paths:
// - initialize / openWorkspace / user refresh → reconcileWorkspace (the only walk).
// - createNote / renameNote / deleteNote / saveNote → never refreshWorkspace;
//   patch notes[] or queryLibrary (no walk).
// - rebuildIndex → consume the returned LibraryPage; do not reconcile again.
// - setQuery / setNavFilter / setScopedFilter → debounce queryLibrary, never reconcile.
// - notes[] is the current query page; libraryStats feeds the sidebar.
// - selectNote / unsaved overlay read by activePath, even if that path is absent from notes[].
import { create } from "zustand";
import type { AppGateways } from "../gateways/contracts";
import { getGateways } from "../gateways";
import {
  fileToBase64,
  imagePathsFromDrop,
  markdownForAttachments,
  MAX_ATTACHMENT_BYTES,
  suggestedPasteFileName,
  type AttachmentFile,
  type SaveAttachmentInput,
} from "../domain/attachments";
import { DEFAULT_WORKSPACE_LAYOUT, mergeLayout } from "../domain/layout";
import { DEFAULT_SETTINGS, mergeSettings, type AppSettings } from "../domain/settings";
import {
  cloudSyncChangedActiveNote,
  cloudSyncTouchedLocal,
  defaultCloudSyncProfile,
  initialCloudSyncProgress,
  mergeCloudSyncProfile,
  mergeCloudSyncReport,
  type CloudSyncProfileInput,
} from "../domain/cloud-sync";
import {
  folderAppearancesForWorkspace,
  normalizeFolderAppearance,
  normalizeFolderKey,
} from "../domain/folders";
import { mapGatewayError } from "../domain/errors";
import {
  emptyLibraryStats,
  libraryQueryFromFilters,
  type LibraryPage,
  type LibraryQuery,
} from "../domain/notes";
import { flushLiveEditor } from "../domain/live-editor";
import { parseNote } from "../domain/notes/note-utils";
import {
  loadWorkspaceSnapshot,
  prepareLibraryProjection,
} from "../application/library/library-use-cases";
import { resolveLocale } from "../i18n/locale";
import { t, tc, type MessageKey, type MessageParams } from "../i18n/translate";
import type { AppStore } from "./types";
import { createAutosaveController } from "./autosave-controller";
import { createDebouncedTask } from "./debounced-task";
import { createUiSlice } from "./slices/ui";
import { createLibrarySlice } from "./slices/library";
import { createEditorSlice } from "./slices/editor";
import { createWorkspaceSlice } from "./slices/workspace";
import { createSyncSlice } from "./slices/sync";
import { createAttachmentSlice } from "./slices/attachments";

function storeLocale(settings: AppSettings) {
  return resolveLocale(settings.appearance.locale);
}

function storeT(settings: AppSettings, key: MessageKey, params?: MessageParams) {
  return t(storeLocale(settings), key, params);
}

const PREFERENCES_DEBOUNCE_MS = 300;
const DRAFT_DEBOUNCE_MS = 450;
const QUERY_DEBOUNCE_MS = 150;
const CLOUD_SYNC_DEBOUNCE_MS = 15_000;
const CLOUD_SYNC_OPEN_DELAY_MS = 2_000;
export const AUTOSAVE_INTERVAL_MS = 3000;
export const NOTE_METADATA_DEBOUNCE_MS = 80;
const NOTE_CONTENT_CACHE_LIMIT = 6;

function favoriteSet(favorites: Record<string, string[]>, root: string) {
  return new Set(favorites[root] || []);
}

type CachedNoteContent = {
  content: string;
  savedContent: string;
  modifiedMs: number | null;
};

function sameLibraryFields(
  left: { title: string; tags: string[]; excerpt: string },
  right: { title: string; tags: string[]; excerpt: string },
) {
  return (
    left.title === right.title &&
    left.excerpt === right.excerpt &&
    left.tags.length === right.tags.length &&
    left.tags.every((tag, index) => tag === right.tags[index])
  );
}

function isOpenUnsavedNote(state: {
  workspaceRoot: string | null;
  activePath: string | null;
  loadedContentPath: string | null;
  content: string;
  savedContent: string;
}) {
  return Boolean(
    state.workspaceRoot &&
      state.activePath &&
      state.loadedContentPath === state.activePath &&
      state.content !== state.savedContent,
  );
}

function toMessage(error: unknown) {
  return mapGatewayError(error).message;
}

function mergeAttachments(current: AttachmentFile[], incoming: AttachmentFile[]) {
  const next = new Map(current.map((item) => [item.relativePath, item]));
  for (const item of incoming) next.set(item.relativePath, item);
  return [...next.values()].sort(
    (left, right) => right.modifiedMs - left.modifiedMs || left.relativePath.localeCompare(right.relativePath),
  );
}

export function createAppStore(gateways: AppGateways = getGateways()) {
  let preferencesTimer: number | null = null;
  let draftTimer: number | null = null;
  let draftIdentity: string | null = null;
  let cloudSyncTimer: number | null = null;
  let cloudSyncInFlight = false;
  let cloudSyncPending = false;
  let cloudSyncProgressWatch: Promise<void> | null = null;
  let metadataTimer: number | null = null;
  let metadataPath: string | null = null;
  let vectorIndexTimer: number | null = null;
  let vectorIndexInFlight = false;
  let vectorIndexPending = false;
  const noteContentCache = new Map<string, CachedNoteContent>();

  const contentCacheKey = (root: string, relativePath: string) => `${root}\0${relativePath}`;
  const cacheNoteContent = (
    root: string,
    relativePath: string,
    content: string,
    savedContent: string,
    modifiedMs: number | null,
  ) => {
    const key = contentCacheKey(root, relativePath);
    noteContentCache.delete(key);
    noteContentCache.set(key, { content, savedContent, modifiedMs });
    while (noteContentCache.size > NOTE_CONTENT_CACHE_LIMIT) {
      const oldest = noteContentCache.keys().next().value;
      if (oldest === undefined) break;
      noteContentCache.delete(oldest);
    }
  };

  const store = create<AppStore>((set, get) => {
    const persistPreferences = () => {
      if (preferencesTimer !== null) window.clearTimeout(preferencesTimer);
      preferencesTimer = window.setTimeout(async () => {
        preferencesTimer = null;
        const state = get();
        try {
          await gateways.persistence.savePreferences(
            state.settings,
            state.workspaceRoot,
            state.isSidebarCollapsed,
            state.layout,
          );
        } catch (error) {
          set({
            error: storeT(state.settings, "errors.savePreferences", {
              message: toMessage(error),
            }),
          });
        }
      }, PREFERENCES_DEBOUNCE_MS);
    };

    const scheduleDraft = (root: string, relativePath: string, content: string, savedContent: string) => {
      if (draftTimer !== null) window.clearTimeout(draftTimer);
      draftIdentity = `${root}\0${relativePath}`;
      draftTimer = window.setTimeout(async () => {
        draftTimer = null;
        try {
          if (content === savedContent) {
            await gateways.persistence.deleteDraft(root, relativePath);
          } else {
            await gateways.persistence.writeDraft(root, relativePath, content);
          }
          if (draftIdentity === `${root}\0${relativePath}`) {
            set((state) => ({
              notes: state.notes.map((note) =>
                note.relativePath === relativePath
                  ? { ...note, dirty: content !== savedContent }
                  : note,
              ),
            }));
          }
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.saveDraft", { message: toMessage(error) }),
          });
        }
      }, DRAFT_DEBOUNCE_MS);
    };

    const scheduleNoteMetadata = (content: string, path: string | null, fileName: string | null) => {
      if (metadataTimer !== null) window.clearTimeout(metadataTimer);
      metadataPath = path;
      if (!path || !fileName) return;
      metadataTimer = window.setTimeout(() => {
        metadataTimer = null;
        const state = get();
        if (state.activePath !== path || metadataPath !== path) return;
        const active = state.notes.find((note) => note.relativePath === path);
        if (!active) return;
        const parsed = parseNote(content, fileName);
        const next = { title: parsed.title, tags: parsed.tags, excerpt: parsed.excerpt };
        if (sameLibraryFields(active, next)) return;
        set({
          notes: state.notes.map((note) =>
            note.relativePath === path ? { ...note, ...next } : note,
          ),
        });
      }, NOTE_METADATA_DEBOUNCE_MS);
    };

    const applyContentUpdate = (content: string) => {
      const state = get();
      const activeNote = state.notes.find((note) => note.relativePath === state.activePath);
      const dirty = content !== state.savedContent;
      const dirtyChanged = Boolean(activeNote && Boolean(activeNote.dirty) !== dirty);
      if (content !== state.content || dirtyChanged) {
        set({
          content,
          notes: dirtyChanged
            ? state.notes.map((note) =>
                note.relativePath === state.activePath ? { ...note, dirty } : note,
              )
            : state.notes,
        });
      }
      if (state.workspaceRoot && state.activePath && state.loadedContentPath === state.activePath) {
        scheduleDraft(state.workspaceRoot, state.activePath, content, state.savedContent);
      }
      scheduleNoteMetadata(content, state.activePath, activeNote?.fileName ?? null);
    };

    const syncLiveEditorContent = () => {
      const state = get();
      const latest = flushLiveEditor(state.activePath);
      if (latest == null || latest === state.content) return;
      applyContentUpdate(latest);
    };

    const scheduleCloudSync = (delayMs = CLOUD_SYNC_DEBOUNCE_MS) => {
      const state = get();
      if (!state.workspaceRoot || !state.cloudSyncProfile.enabled) return;
      if (cloudSyncInFlight) {
        cloudSyncPending = true;
        return;
      }
      if (cloudSyncTimer !== null) window.clearTimeout(cloudSyncTimer);
      cloudSyncTimer = window.setTimeout(() => {
        cloudSyncTimer = null;
        void runScheduledCloudSync();
      }, delayMs);
    };

    const runScheduledCloudSync = async () => {
      const state = get();
      if (!state.workspaceRoot || !state.cloudSyncProfile.enabled) return;
      await get().runCloudSync();
    };

    const ensureCloudSyncProgressWatch = () => {
      if (cloudSyncProgressWatch) return;
      cloudSyncProgressWatch = gateways.cloudSync
        .watchProgress((progress) => {
          if (!cloudSyncInFlight) return;
          set({ cloudSyncProgress: progress });
        })
        .then(() => undefined)
        .catch(() => undefined);
    };

    const loadCloudSyncProfile = async (root: string | null) => {
      if (!root) {
        set({ cloudSyncProfile: defaultCloudSyncProfile() });
        return;
      }
      try {
        const profile = await gateways.cloudSync.getProfile(root);
        set({ cloudSyncProfile: mergeCloudSyncProfile(profile) });
      } catch {
        set({ cloudSyncProfile: defaultCloudSyncProfile() });
      }
    };

    const currentQuery = (state = get()): LibraryQuery =>
      libraryQueryFromFilters(
        state.query,
        state.navFilter,
        state.scopedFilter,
        state.favoritePaths,
      );

    const runVectorIndex = async () => {
      const state = get();
      if (!state.workspaceRoot || !state.settings.ai.enabled) return;
      if (vectorIndexInFlight) {
        vectorIndexPending = true;
        return;
      }
      vectorIndexInFlight = true;
      try {
        await gateways.workspace.indexVectorWorkspace(state.workspaceRoot, state.settings.ai, false);
      } catch (error) {
        // Background indexing must not interrupt editing; the index panel exposes the failure.
        set({ error: storeT(get().settings, "errors.vectorIndex", { message: toMessage(error) }) });
      } finally {
        vectorIndexInFlight = false;
        if (vectorIndexPending) {
          vectorIndexPending = false;
          scheduleVectorIndex(400);
        }
      }
    };

    const scheduleVectorIndex = (delayMs = 1200) => {
      const state = get();
      if (!state.workspaceRoot || !state.settings.ai.enabled) return;
      if (vectorIndexTimer !== null) window.clearTimeout(vectorIndexTimer);
      vectorIndexTimer = window.setTimeout(() => {
        vectorIndexTimer = null;
        void runVectorIndex();
      }, delayMs);
    };

    const applyLibraryPage = async (
      root: string,
      page: LibraryPage,
      preferredPath?: string | null,
      options?: { selectIfNeeded?: boolean; scanAttachments?: boolean },
    ) => {
      const projection = await prepareLibraryProjection(gateways, root, page);
      const { notes, favoritePaths, folderAppearances } = projection;
      const current = get();
      const overlaid = isOpenUnsavedNote(current)
        ? notes.map((note) =>
            note.relativePath === current.activePath
              ? {
                  ...note,
                  ...parseNote(current.content, note.fileName),
                  dirty: true,
                }
              : note,
          )
        : notes;
      const selectIfNeeded = options?.selectIfNeeded !== false;
      const preferred = preferredPath || null;
      const selected = selectIfNeeded
        ? (preferred ??
          (current.activePath &&
          (overlaid.some((note) => note.relativePath === current.activePath) ||
            current.loadedContentPath === current.activePath)
            ? current.activePath
            : null) ??
          overlaid[0]?.relativePath ??
          null)
        : current.activePath;
      const alreadyOpen = selected !== null && current.loadedContentPath === selected;
      set({
        notes: overlaid,
        libraryStats: page.stats,
        favoritePaths,
        folderAppearances,
        isLoading: false,
        status: tc(storeLocale(get().settings), "status.noteCount", page.stats.total),
        ...(selectIfNeeded ? { activePath: selected } : {}),
      });
      if (selectIfNeeded && selected && !alreadyOpen) await get().selectNote(selected);
    };

    const runLibraryQuery = async (seq: number) => {
      const state = get();
      const root = state.workspaceRoot;
      if (!root) return;
      try {
        const page = await gateways.workspace.queryLibrary(root, currentQuery(state));
        if (!libraryQuery.isCurrent(seq) || get().workspaceRoot !== root) return;
        await applyLibraryPage(root, page, null, { selectIfNeeded: false });
      } catch (error) {
        if (!libraryQuery.isCurrent(seq)) return;
        set({
          error: storeT(get().settings, "errors.refreshWorkspace", {
            message: toMessage(error),
          }),
        });
      }
    };

    const libraryQuery = createDebouncedTask(runLibraryQuery, QUERY_DEBOUNCE_MS);

    const saveActiveNoteAction = async () => {
      syncLiveEditorContent();
      const { workspaceRoot, activePath, content, loadedContentPath, isSaving } = get();
      if (!workspaceRoot || !activePath || loadedContentPath !== activePath || isSaving) return;
      const saveRoot = workspaceRoot;
      const savePath = activePath;
      const saveContent = content;
      set({ isSaving: true, error: "" });
      try {
        await gateways.workspace.writeNote(saveRoot, savePath, saveContent);
        await gateways.persistence.deleteDraft(saveRoot, savePath);
        set((state) => {
          if (state.workspaceRoot !== saveRoot || state.activePath !== savePath) {
            return { isSaving: false };
          }
          const stillDirty = state.content !== saveContent;
          return {
            isSaving: false,
            savedContent: saveContent,
            status: stillDirty ? state.status : storeT(state.settings, "status.saved"),
            notes: state.notes.map((note) =>
              note.relativePath === savePath
                ? {
                    ...note,
                    ...parseNote(saveContent, note.fileName),
                    modifiedMs: Date.now(),
                    dirty: stillDirty,
                  }
                : note,
            ),
          };
        });
        scheduleCloudSync();
        scheduleVectorIndex();
      } catch (error) {
        set((state) => ({
          isSaving: state.activePath === savePath ? false : state.isSaving,
          error: storeT(state.settings, "errors.saveNote", { message: toMessage(error) }),
        }));
      }
    };

    const selectNoteAction = async (relativePath: string) => {
      syncLiveEditorContent();
      const current = get();
      const root = current.workspaceRoot;
      if (!root) return;
      if (current.activePath === relativePath && current.loadedContentPath === relativePath) {
        if (current.mobilePanel !== "editor") set({ mobilePanel: "editor" });
        return;
      }
      if (current.activePath && current.loadedContentPath === current.activePath) {
        cacheNoteContent(root, current.activePath, current.content, current.savedContent,
          current.notes.find((note) => note.relativePath === current.activePath)?.modifiedMs ?? null);
      }
      const targetModifiedMs = current.notes.find((note) => note.relativePath === relativePath)?.modifiedMs ?? null;
      const cacheKey = contentCacheKey(root, relativePath);
      const cached = noteContentCache.get(cacheKey);
      if (cached && cached.modifiedMs === targetModifiedMs) {
        noteContentCache.delete(cacheKey);
        noteContentCache.set(cacheKey, cached);
        set({ activePath: relativePath, content: cached.content, savedContent: cached.savedContent,
          loadedContentPath: relativePath, isLoading: false, error: "", mobilePanel: "editor",
          isSaving: false, status: cached.content !== cached.savedContent
            ? storeT(current.settings, "status.draftRestored") : storeT(current.settings, "status.loaded") });
        return;
      }
      noteContentCache.delete(cacheKey);
      set({ activePath: relativePath, isLoading: true, error: "", mobilePanel: "editor", isSaving: false });
      try {
        const [savedContent, draft] = await Promise.all([
          gateways.workspace.readNote(root, relativePath),
          gateways.persistence.readDraft(root, relativePath),
        ]);
        if (get().activePath !== relativePath) return;
        cacheNoteContent(root, relativePath, draft ?? savedContent, savedContent, targetModifiedMs);
        set({ content: draft ?? savedContent, savedContent, loadedContentPath: relativePath,
          isLoading: false, status: draft !== null && draft !== savedContent
            ? storeT(get().settings, "status.draftRestored") : storeT(get().settings, "status.loaded") });
      } catch (error) {
        set({ isLoading: false, error: storeT(get().settings, "errors.loadNote", { message: toMessage(error) }) });
      }
    };

    const setFolderAppearanceAction = async (folder: string, appearance: import("../domain/folders").FolderAppearance | null) => {
      const { workspaceRoot, folderAppearances } = get();
      if (!workspaceRoot) return;
      const key = normalizeFolderKey(folder);
      const nextAppearance = appearance ? normalizeFolderAppearance(appearance) : undefined;
      const next = { ...folderAppearances };
      if (nextAppearance) next[key] = nextAppearance;
      else delete next[key];
      set({ folderAppearances: next });
      try {
        const state = await gateways.persistence.setFolderAppearance(
          workspaceRoot,
          key,
          nextAppearance ?? null,
        );
        set({
          folderAppearances: folderAppearancesForWorkspace(state.folderAppearances, workspaceRoot),
        });
      } catch (error) {
        set({
          folderAppearances,
          error: storeT(get().settings, "errors.saveFolderAppearance", {
            message: toMessage(error),
          }),
        });
      }
    };

    const toggleFavoriteAction = async (relativePath?: string) => {
      const { workspaceRoot, activePath, notes, favoritePaths, libraryStats, navFilter } = get();
      const path = relativePath ?? activePath;
      if (!workspaceRoot || !path) return;
      const favorite = !favoritePaths.includes(path);
      const nextFavorites = favorite
        ? [...favoritePaths, path]
        : favoritePaths.filter((item) => item !== path);
      set({
        favoritePaths: nextFavorites,
        notes: notes.map((item) => item.relativePath === path ? { ...item, favorite } : item),
        libraryStats: {
          ...libraryStats,
          favorites: Math.max(0, libraryStats.favorites + (favorite ? 1 : -1)),
        },
      });
      try {
        await gateways.persistence.setFavorite(workspaceRoot, path, favorite);
        if (navFilter === "favorites") libraryQuery.runNow();
      } catch (error) {
        set({
          notes,
          favoritePaths,
          libraryStats,
          error: storeT(get().settings, "errors.saveFavorite", { message: toMessage(error) }),
        });
      }
    };

    const createNoteAction = async (input: {
      title: string;
      extension: "md" | "mdx";
      folder?: string;
      tags?: string[];
    }) => {
      syncLiveEditorContent();
      const root = get().workspaceRoot;
      if (!root) return;
      set({ isLoading: true, error: "" });
      try {
        const created = await gateways.workspace.createNote({ root, ...input });
        const page = await gateways.workspace.queryLibrary(root, currentQuery());
        await applyLibraryPage(root, page, created.relativePath);
        scheduleVectorIndex();
      } catch (error) {
        set({
          isLoading: false,
          error: storeT(get().settings, "errors.createNote", { message: toMessage(error) }),
        });
      }
    };

    const createFolderAction = async (folder: string) => {
      const root = get().workspaceRoot;
      const normalized = normalizeFolderKey(folder);
      if (!root || !normalized) return;
      set({ isLoading: true, error: "" });
      try {
        await gateways.workspace.createFolder(root, normalized);
        const page = await gateways.workspace.queryLibrary(root, currentQuery());
        await applyLibraryPage(root, page);
      } catch (error) {
        set({
          isLoading: false,
          error: storeT(get().settings, "errors.createFolder", { message: toMessage(error) }),
        });
      }
    };

    const rebuildIndexAction = async () => {
      const root = get().workspaceRoot;
      if (!root) return;
      set({ isLoading: true, error: "" });
      try {
        const page = await gateways.workspace.rebuildIndex(root, currentQuery());
        await applyLibraryPage(root, page);
        scheduleVectorIndex(100);
        set({ status: storeT(get().settings, "status.indexRebuilt") });
      } catch (error) {
        set({
          isLoading: false,
          error: storeT(get().settings, "errors.rebuildIndex", { message: toMessage(error) }),
        });
      }
    };

    const renameNoteAction = async (relativePath: string, newRelativePath: string) => {
      syncLiveEditorContent();
      const { workspaceRoot, activePath, content, savedContent, notes } = get();
      const trimmed = newRelativePath.trim();
      if (!workspaceRoot || !relativePath || !trimmed || relativePath === trimmed) return;
      set({ isLoading: true, error: "" });
      try {
        const renamed = await gateways.workspace.renameNote(workspaceRoot, relativePath, trimmed);
        const note = notes.find((item) => item.relativePath === relativePath);
        const draft = await gateways.persistence.readDraft(workspaceRoot, relativePath);
        const nextDraft = relativePath === activePath && content !== savedContent ? content : draft;
        await gateways.persistence.deleteDraft(workspaceRoot, relativePath);
        if (nextDraft !== null) {
          await gateways.persistence.writeDraft(workspaceRoot, renamed.note.relativePath, nextDraft);
        }
        const favoritePaths = get().favoritePaths.includes(relativePath) || Boolean(note?.favorite)
          ? [...get().favoritePaths.filter((path) => path !== relativePath), renamed.note.relativePath]
          : get().favoritePaths;
        if (note?.favorite || get().favoritePaths.includes(relativePath)) {
          await gateways.persistence.setFavorite(workspaceRoot, relativePath, false);
          await gateways.persistence.setFavorite(workspaceRoot, renamed.note.relativePath, true);
        }
        const wasActive = relativePath === activePath;
        set(wasActive
          ? { activePath: renamed.note.relativePath, loadedContentPath: renamed.note.relativePath, favoritePaths }
          : { favoritePaths });
        const page = await gateways.workspace.queryLibrary(workspaceRoot, currentQuery());
        await applyLibraryPage(workspaceRoot, page, wasActive ? renamed.note.relativePath : undefined, {
          selectIfNeeded: wasActive,
        });
        scheduleVectorIndex();
      } catch (error) {
        set({
          isLoading: false,
          error: storeT(get().settings, "errors.renameNote", { message: toMessage(error) }),
        });
      }
    };

    const renameActiveNoteAction = async (newRelativePath: string) => {
      const { activePath } = get();
      if (activePath) await renameNoteAction(activePath, newRelativePath);
    };

    const deleteNoteAction = async (relativePath: string) => {
      syncLiveEditorContent();
      const { workspaceRoot, activePath, notes } = get();
      if (!workspaceRoot || !relativePath) return;
      set({ isLoading: true, error: "" });
      try {
        const note = notes.find((item) => item.relativePath === relativePath);
        await gateways.workspace.deleteNote(workspaceRoot, relativePath);
        await gateways.persistence.deleteDraft(workspaceRoot, relativePath);
        if (note?.favorite) await gateways.persistence.setFavorite(workspaceRoot, relativePath, false);
        const nextFavorites = get().favoritePaths.filter((path) => path !== relativePath);
        if (relativePath === activePath) {
          set({ activePath: null, loadedContentPath: null, content: "", savedContent: "", favoritePaths: nextFavorites });
        } else set({ favoritePaths: nextFavorites });
        const page = await gateways.workspace.queryLibrary(workspaceRoot, currentQuery());
        await applyLibraryPage(workspaceRoot, page, null, { selectIfNeeded: relativePath === activePath });
        scheduleVectorIndex();
      } catch (error) {
        set({
          isLoading: false,
          error: storeT(get().settings, "errors.deleteNote", { message: toMessage(error) }),
        });
      }
    };

    const deleteActiveNoteAction = async () => {
      const { activePath } = get();
      if (activePath) await deleteNoteAction(activePath);
    };

    const refreshWorkspaceAction = async (preferredPath?: string | null) => {
      const root = get().workspaceRoot;
      if (!root) return;
      set({ isLoading: true, error: "" });
      try {
        const { page, attachments } = await loadWorkspaceSnapshot(gateways, root, currentQuery());
        set({ attachments });
        await applyLibraryPage(root, page, preferredPath);
        scheduleVectorIndex();
      } catch (error) {
        set({
          isLoading: false,
          error: storeT(get().settings, "errors.refreshWorkspace", { message: toMessage(error) }),
        });
      }
    };

    const initializeAction = async () => {
      ensureCloudSyncProgressWatch();
      try {
        const appState = await gateways.persistence.loadAppState();
        const settings = mergeSettings(appState.preferences);
        const workspaceRoot = appState.lastWorkspace;
        set({
          settings,
          viewMode: settings.editor.defaultView,
          workspaceRoot,
          recentWorkspaces: appState.recentWorkspaces,
          isSidebarCollapsed: appState.sidebarCollapsed,
          layout: mergeLayout(appState.layout),
          favoritePaths: workspaceRoot ? [...favoriteSet(appState.favorites, workspaceRoot)] : [],
          folderAppearances: workspaceRoot
            ? folderAppearancesForWorkspace(appState.folderAppearances, workspaceRoot)
            : {},
        });
        if (workspaceRoot) {
          await loadCloudSyncProfile(workspaceRoot);
          await get().refreshWorkspace();
          scheduleCloudSync(CLOUD_SYNC_OPEN_DELAY_MS);
        }
        set({ initialized: true });
      } catch (error) {
        set({
          initialized: true,
          error: storeT(get().settings, "errors.loadAppState", { message: toMessage(error) }),
        });
      }
    };

    const openWorkspaceAction = async (root?: string) => {
      syncLiveEditorContent();
      const current = get();
      if (isOpenUnsavedNote(current) && current.workspaceRoot && current.activePath) {
        try {
          await gateways.persistence.writeDraft(current.workspaceRoot, current.activePath, current.content);
        } catch {
          // Switching still proceeds; only this unsaved burst may be lost.
        }
      }
      if (draftTimer !== null) {
        window.clearTimeout(draftTimer);
        draftTimer = null;
      }
      draftIdentity = null;
      set({ isLoading: true, error: "" });
      try {
        const selectedRoot = root ?? await gateways.workspace.chooseWorkspace(
          storeT(get().settings, "workspace.chooseFolder"),
        );
        if (!selectedRoot) {
          set({ isLoading: false });
          return;
        }
        const persistedState = await gateways.persistence.savePreferences(
          get().settings,
          selectedRoot,
          get().isSidebarCollapsed,
          get().layout,
        );
        const workspaceRoot = persistedState.lastWorkspace || selectedRoot;
        const recentWorkspaces = persistedState.recentWorkspaces.length
          ? persistedState.recentWorkspaces
          : [workspaceRoot];
        if (workspaceRoot === get().workspaceRoot) {
          set({ recentWorkspaces });
          await loadCloudSyncProfile(workspaceRoot);
          await get().refreshWorkspace();
          scheduleCloudSync(CLOUD_SYNC_OPEN_DELAY_MS);
          return;
        }
        noteContentCache.clear();
        set({
          workspaceRoot,
          recentWorkspaces,
          favoritePaths: [...favoriteSet(persistedState.favorites, workspaceRoot)],
          folderAppearances: folderAppearancesForWorkspace(persistedState.folderAppearances, workspaceRoot),
          attachments: [],
          activePath: null,
          loadedContentPath: null,
          content: "",
          savedContent: "",
          query: "",
          navFilter: "all",
          scopedFilter: null,
          libraryPanelMode: "notes",
        });
        await loadCloudSyncProfile(workspaceRoot);
        await get().refreshWorkspace();
        scheduleCloudSync(CLOUD_SYNC_OPEN_DELAY_MS);
      } catch (error) {
        set({
          isLoading: false,
          error: storeT(get().settings, "errors.openWorkspace", { message: toMessage(error) }),
        });
      }
    };

    const refreshAttachmentsAction = async () => {
      const root = get().workspaceRoot;
      if (!root) {
        set({ attachments: [] });
        return;
      }
      try {
        set({ attachments: await gateways.attachments.scanAttachments(root) });
      } catch (error) {
        set({
          error: storeT(get().settings, "errors.loadAttachments", { message: toMessage(error) }),
        });
      }
    };

    const saveAttachmentsAction = async (inputs: SaveAttachmentInput[]) => {
      const root = get().workspaceRoot;
      if (!root || inputs.length === 0) return [];
      try {
        const saved: AttachmentFile[] = [];
        for (const input of inputs) saved.push(await gateways.attachments.saveAttachment(root, input));
        set({
          attachments: mergeAttachments(get().attachments, saved),
          status: storeT(get().settings, "status.attachmentSaved"),
          error: "",
        });
        scheduleCloudSync();
        return saved;
      } catch (error) {
        set({ error: storeT(get().settings, "errors.saveAttachment", { message: toMessage(error) }) });
        return [];
      }
    };

    const savePastedImagesAction = async (files: File[]) => {
      const { workspaceRoot, activePath, settings } = get();
      if (!workspaceRoot) return "";
      if (!activePath) {
        set({ error: storeT(settings, "errors.pasteNeedsNote") });
        return "";
      }
      if (files.some((file) => file.size > MAX_ATTACHMENT_BYTES)) {
        set({ error: storeT(settings, "errors.attachmentTooLarge") });
        return "";
      }
      const inputs = await Promise.all(files.map(async (file) => ({
        bytesBase64: await fileToBase64(file),
        fileName: suggestedPasteFileName(file),
        mimeType: file.type,
      })));
      const saved = await saveAttachmentsAction(inputs);
      return markdownForAttachments(get().activePath, saved);
    };

    const importDroppedImagesAction = async (sourcePaths: string[]) => {
      const { workspaceRoot, activePath, settings } = get();
      const paths = imagePathsFromDrop(sourcePaths);
      if (!workspaceRoot || paths.length === 0) return "";
      if (!activePath) {
        set({ error: storeT(settings, "errors.pasteNeedsNote") });
        return "";
      }
      try {
        const imported = await gateways.attachments.importAttachmentsFromPaths(workspaceRoot, paths);
        if (!imported.length) return "";
        set({ attachments: mergeAttachments(get().attachments, imported), status: storeT(get().settings, "status.attachmentSaved"), error: "" });
        return markdownForAttachments(get().activePath, imported);
      } catch (error) {
        set({ error: storeT(get().settings, "errors.importAttachment", { message: toMessage(error) }) });
        return "";
      }
    };

    const importAttachmentsAction = async () => {
      const root = get().workspaceRoot;
      if (!root) return [];
      try {
        const imported = await gateways.attachments.importAttachments(root);
        if (imported.length) set({ attachments: mergeAttachments(get().attachments, imported), status: storeT(get().settings, "status.attachmentsImported"), error: "" });
        return imported;
      } catch (error) {
        set({ error: storeT(get().settings, "errors.importAttachment", { message: toMessage(error) }) });
        return [];
      }
    };

    const deleteAttachmentAction = async (relativePath: string) => {
      const root = get().workspaceRoot;
      if (!root || !relativePath) return;
      try {
        await gateways.attachments.deleteAttachment(root, relativePath);
        set({ attachments: get().attachments.filter((item) => item.relativePath !== relativePath), status: storeT(get().settings, "status.attachmentDeleted"), error: "" });
      } catch (error) {
        set({ error: storeT(get().settings, "errors.deleteAttachment", { message: toMessage(error) }) });
      }
    };

    const saveCloudSyncProfileAction = async (profile: CloudSyncProfileInput) => {
      const root = get().workspaceRoot;
      if (!root) return;
      try {
        const saved = await gateways.cloudSync.saveProfile(root, profile);
        set({
          cloudSyncProfile: mergeCloudSyncProfile(saved),
          status: storeT(get().settings, "status.cloudSyncSaved"),
        });
      } catch (error) {
        set({
          error: storeT(get().settings, "errors.saveCloudSync", { message: toMessage(error) }),
        });
        throw error;
      }
    };

    const testCloudSyncAction = (profile: CloudSyncProfileInput) =>
      gateways.cloudSync.testConnection(profile);

    const runCloudSyncAction = async (profile?: CloudSyncProfileInput) => {
      const root = get().workspaceRoot;
      if (!root) return null;
      if (cloudSyncInFlight) {
        cloudSyncPending = true;
        return null;
      }
      ensureCloudSyncProgressWatch();
      cloudSyncInFlight = true;
      set({ cloudSyncProgress: initialCloudSyncProgress() });
      const unsaved = isOpenUnsavedNote(get());
      const activePath = get().activePath;
      try {
        const result = await gateways.cloudSync.runSync(root, profile);
        const report = mergeCloudSyncReport(result.report) ?? result.report;
        set({
          cloudSyncProfile: mergeCloudSyncProfile(result.profile),
          status: storeT(get().settings, "status.cloudSyncComplete"),
        });
        if (cloudSyncTouchedLocal(report)) await get().refreshWorkspace();
        if (
          !unsaved &&
          activePath &&
          get().activePath === activePath &&
          cloudSyncChangedActiveNote(report, activePath)
        ) {
          await get().selectNote(activePath);
        }
        return { ...result, report };
      } catch (error) {
        set({
          error: storeT(get().settings, "errors.runCloudSync", { message: toMessage(error) }),
        });
        throw error;
      } finally {
        cloudSyncInFlight = false;
        set({ cloudSyncProgress: null });
        if (cloudSyncPending) {
          cloudSyncPending = false;
          void get().runCloudSync();
        }
      }
    };

    return {
      workspaceRoot: null,
      recentWorkspaces: [],
      notes: [],
      libraryStats: emptyLibraryStats(),
      favoritePaths: [],
      attachments: [],
      isLoading: false,
      folderAppearances: {},
      activePath: null,
      loadedContentPath: null,
      content: "",
      savedContent: "",
      isSaving: false,
      query: "",
      navFilter: "all",
      scopedFilter: null,
      libraryPanelMode: "notes",
      settings: DEFAULT_SETTINGS,
      initialized: false,
      status: storeT(DEFAULT_SETTINGS, "status.openFolder"),
      error: "",
      viewMode: DEFAULT_SETTINGS.editor.defaultView,
      isSidebarCollapsed: false,
      layout: DEFAULT_WORKSPACE_LAYOUT,
      settingsOpen: false,
      settingsSection: "appearance",
      cloudSyncProfile: defaultCloudSyncProfile(),
      cloudSyncProgress: null,
      mobilePanel: "editor",

      // Reconcile is the only walk: initialize, openWorkspace, and explicit refresh.
      // Mutate paths (create/rename/delete/save) and filter changes must not call this.

      ...createEditorSlice({ setContent: applyContentUpdate, saveActiveNote: saveActiveNoteAction, selectNote: selectNoteAction }),

      ...createWorkspaceSlice({
        openWorkspace: openWorkspaceAction,
        initialize: initializeAction,
        refreshWorkspace: refreshWorkspaceAction,
        createNote: createNoteAction,
        createFolder: createFolderAction,
        rebuildIndex: rebuildIndexAction,
        renameNote: renameNoteAction,
        renameActiveNote: renameActiveNoteAction,
        deleteNote: deleteNoteAction,
        deleteActiveNote: deleteActiveNoteAction,
        setFolderAppearance: setFolderAppearanceAction,
        toggleFavorite: toggleFavoriteAction,
      }),

      ...createAttachmentSlice({
        refreshAttachments: refreshAttachmentsAction,
        saveAttachments: saveAttachmentsAction,
        savePastedImages: savePastedImagesAction,
        importDroppedImages: importDroppedImagesAction,
        importAttachments: importAttachmentsAction,
        deleteAttachment: deleteAttachmentAction,
      }),
      ...createLibrarySlice({
        set,
        scheduleQuery: libraryQuery.schedule,
        runQueryNow: () => {
          libraryQuery.runNow();
        },
      }),
      ...createUiSlice({
        set,
        get,
        persistPreferences,
        onSettingsChanged: (previous, next) => {
          const connectionChanged =
            previous.ai.enabled !== next.ai.enabled ||
            previous.ai.provider !== next.ai.provider ||
            previous.ai.baseUrl !== next.ai.baseUrl ||
            previous.ai.apiKey !== next.ai.apiKey ||
            previous.ai.embeddingModel !== next.ai.embeddingModel;
          if (next.ai.enabled && connectionChanged) scheduleVectorIndex(100);
        },
      }),
      ...createSyncSlice({
        saveProfile: saveCloudSyncProfileAction,
        testConnection: testCloudSyncAction,
        run: runCloudSyncAction,
      }),
    };
  });

  const autosave = createAutosaveController({
    getState: store.getState,
    isDirty: isOpenUnsavedNote,
    isSaving: (state) => state.isSaving,
    save: (state) => state.saveActiveNote(),
    intervalMs: AUTOSAVE_INTERVAL_MS,
  });
  store.subscribe(autosave.sync);
  return store;
}

export const useAppStore = createAppStore();
