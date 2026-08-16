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
import { DEFAULT_SETTINGS, mergeSettings, type AppSettings } from "../domain/settings";
import {
  defaultCloudSyncProfile,
  mergeCloudSyncProfile,
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
  type NoteMeta,
  type RawNoteFile,
} from "../domain/notes";
import { parseNote } from "../features/library/note-utils";
import { resolveLocale } from "../i18n/locale";
import { t, tc, type MessageKey, type MessageParams } from "../i18n/translate";
import type { AppStore } from "./types";

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

function favoriteSet(favorites: Record<string, string[]>, root: string) {
  return new Set(favorites[root] || []);
}

async function assembleNotes(
  gateways: AppGateways,
  root: string,
  files: RawNoteFile[],
  favorites: Set<string>,
  draftPaths: string[],
): Promise<NoteMeta[]> {
  const draftSet = new Set(draftPaths);
  return Promise.all(
    files.map(async (file): Promise<NoteMeta> => {
      const favorite = favorites.has(file.relativePath);
      if (!draftSet.has(file.relativePath)) {
        return { ...file, favorite, dirty: false };
      }
      try {
        const draft = await gateways.persistence.readDraft(root, file.relativePath);
        if (draft == null) {
          return { ...file, favorite, dirty: false };
        }
        const parsed = parseNote(draft, file.fileName);
        return { ...file, ...parsed, favorite, dirty: true };
      } catch {
        return {
          ...file,
          title: file.fileName.replace(/\.(md|mdx)$/i, ""),
          tags: [],
          excerpt: "",
          favorite,
        };
      }
    }),
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
  let autosaveTimer: number | null = null;
  let queryTimer: number | null = null;
  let querySeq = 0;
  let cloudSyncTimer: number | null = null;
  let cloudSyncInFlight = false;

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

    const scheduleCloudSync = (delayMs = CLOUD_SYNC_DEBOUNCE_MS) => {
      const state = get();
      if (!state.workspaceRoot || !state.cloudSyncProfile.enabled) return;
      if (cloudSyncTimer !== null) window.clearTimeout(cloudSyncTimer);
      cloudSyncTimer = window.setTimeout(() => {
        cloudSyncTimer = null;
        void runScheduledCloudSync();
      }, delayMs);
    };

    const runScheduledCloudSync = async () => {
      const state = get();
      if (!state.workspaceRoot || !state.cloudSyncProfile.enabled || cloudSyncInFlight) return;
      cloudSyncInFlight = true;
      try {
        await get().runCloudSync();
      } catch {
        // Store already records the error.
      } finally {
        cloudSyncInFlight = false;
      }
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

    const applyLibraryPage = async (
      root: string,
      page: LibraryPage,
      preferredPath?: string | null,
      options?: { selectIfNeeded?: boolean; scanAttachments?: boolean },
    ) => {
      const appState = await gateways.persistence.loadAppState();
      const favorites = favoriteSet(appState.favorites, root);
      const favoritePaths = [...favorites];
      const draftPaths = await gateways.persistence.draftsExist(
        root,
        page.notes.map((file) => file.relativePath),
      );
      const notes = await assembleNotes(gateways, root, page.notes, favorites, draftPaths);
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
        folderAppearances: folderAppearancesForWorkspace(appState.folderAppearances, root),
        isLoading: false,
        status: tc(storeLocale(get().settings), "status.noteCount", page.stats.total),
        ...(selectIfNeeded ? { activePath: selected } : {}),
      });
      if (selectIfNeeded && selected && !alreadyOpen) await get().selectNote(selected);
    };

    const runLibraryQuery = async () => {
      const seq = ++querySeq;
      const state = get();
      const root = state.workspaceRoot;
      if (!root) return;
      try {
        const page = await gateways.workspace.queryLibrary(root, currentQuery(state));
        if (seq !== querySeq || get().workspaceRoot !== root) return;
        await applyLibraryPage(root, page, null, { selectIfNeeded: false });
      } catch (error) {
        if (seq !== querySeq) return;
        set({
          error: storeT(get().settings, "errors.refreshWorkspace", {
            message: toMessage(error),
          }),
        });
      }
    };

    const scheduleLibraryQuery = () => {
      if (queryTimer !== null) window.clearTimeout(queryTimer);
      queryTimer = window.setTimeout(() => {
        queryTimer = null;
        void runLibraryQuery();
      }, QUERY_DEBOUNCE_MS);
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
      settingsOpen: false,
      settingsSection: "appearance",
      cloudSyncProfile: defaultCloudSyncProfile(),
      mobilePanel: "editor",

      async initialize() {
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
            favoritePaths: workspaceRoot
              ? [...favoriteSet(appState.favorites, workspaceRoot)]
              : [],
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
      },

      async openWorkspace(root) {
        const current = get();
        if (isOpenUnsavedNote(current) && current.workspaceRoot && current.activePath) {
          try {
            await gateways.persistence.writeDraft(
              current.workspaceRoot,
              current.activePath,
              current.content,
            );
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
          const selectedRoot =
            root ??
            (await gateways.workspace.chooseWorkspace(
              storeT(get().settings, "workspace.chooseFolder"),
            ));
          if (!selectedRoot) {
            set({ isLoading: false });
            return;
          }
          const persistedState = await gateways.persistence.savePreferences(
            get().settings,
            selectedRoot,
            get().isSidebarCollapsed,
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
          set({
            workspaceRoot,
            recentWorkspaces,
            favoritePaths: [...favoriteSet(persistedState.favorites, workspaceRoot)],
            folderAppearances: folderAppearancesForWorkspace(
              persistedState.folderAppearances,
              workspaceRoot,
            ),
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
      },

      // Reconcile is the only walk: initialize, openWorkspace, and explicit refresh.
      // Mutate paths (create/rename/delete/save) and filter changes must not call this.
      async refreshWorkspace(preferredPath) {
        const root = get().workspaceRoot;
        if (!root) return;
        set({ isLoading: true, error: "" });
        try {
          const [page, attachments] = await Promise.all([
            gateways.workspace.reconcileWorkspace(root, currentQuery()),
            gateways.workspace.scanAttachments(root),
          ]);
          set({ attachments });
          await applyLibraryPage(root, page, preferredPath);
        } catch (error) {
          set({
            isLoading: false,
            error: storeT(get().settings, "errors.refreshWorkspace", {
              message: toMessage(error),
            }),
          });
        }
      },

      async selectNote(relativePath) {
        const root = get().workspaceRoot;
        if (!root) return;
        set({
          activePath: relativePath,
          isLoading: true,
          error: "",
          mobilePanel: "editor",
          isSaving: false,
        });
        try {
          const [savedContent, draft] = await Promise.all([
            gateways.workspace.readNote(root, relativePath),
            gateways.persistence.readDraft(root, relativePath),
          ]);
          if (get().activePath !== relativePath) return;
          set({
            content: draft ?? savedContent,
            savedContent,
            loadedContentPath: relativePath,
            isLoading: false,
            status:
              draft !== null && draft !== savedContent
                ? storeT(get().settings, "status.draftRestored")
                : storeT(get().settings, "status.loaded"),
          });
        } catch (error) {
          set({
            isLoading: false,
            error: storeT(get().settings, "errors.loadNote", { message: toMessage(error) }),
          });
        }
      },

      setContent(content) {
        const state = get();
        const activeNote = state.notes.find((note) => note.relativePath === state.activePath);
        const metadata = activeNote ? parseNote(content, activeNote.fileName) : null;
        set({
          content,
          notes: metadata
            ? state.notes.map((note) =>
                note.relativePath === state.activePath
                  ? {
                      ...note,
                      ...metadata,
                      dirty: content !== state.savedContent,
                    }
                  : note,
              )
            : state.notes,
        });
        if (state.workspaceRoot && state.activePath && state.loadedContentPath === state.activePath) {
          scheduleDraft(state.workspaceRoot, state.activePath, content, state.savedContent);
        }
      },

      async saveActiveNote() {
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
        } catch (error) {
          set((state) => ({
            isSaving: state.activePath === savePath ? false : state.isSaving,
            error: storeT(state.settings, "errors.saveNote", { message: toMessage(error) }),
          }));
        }
      },

      async createNote(input) {
        const root = get().workspaceRoot;
        if (!root) return;
        set({ isLoading: true, error: "" });
        try {
          const created = await gateways.workspace.createNote({ root, ...input });
          const page = await gateways.workspace.queryLibrary(root, currentQuery());
          await applyLibraryPage(root, page, created.relativePath);
        } catch (error) {
          set({
            isLoading: false,
            error: storeT(get().settings, "errors.createNote", { message: toMessage(error) }),
          });
        }
      },

      async renameNote(relativePath, newRelativePath) {
        const { workspaceRoot, activePath, content, savedContent, notes } = get();
        const trimmed = newRelativePath.trim();
        if (!workspaceRoot || !relativePath || !trimmed || relativePath === trimmed) return;
        set({ isLoading: true, error: "" });
        try {
          const renamed = await gateways.workspace.renameNote(
            workspaceRoot,
            relativePath,
            trimmed,
          );
          const note = notes.find((item) => item.relativePath === relativePath);
          const draft = await gateways.persistence.readDraft(workspaceRoot, relativePath);
          const nextDraft =
            relativePath === activePath && content !== savedContent ? content : draft;
          await gateways.persistence.deleteDraft(workspaceRoot, relativePath);
          if (nextDraft !== null) {
            await gateways.persistence.writeDraft(workspaceRoot, renamed.note.relativePath, nextDraft);
          }
          const favoritePaths = get().favoritePaths.includes(relativePath)
            || Boolean(note?.favorite)
            ? [
                ...get().favoritePaths.filter((path) => path !== relativePath),
                renamed.note.relativePath,
              ]
            : get().favoritePaths;
          if (note?.favorite || get().favoritePaths.includes(relativePath)) {
            await gateways.persistence.setFavorite(workspaceRoot, relativePath, false);
            await gateways.persistence.setFavorite(workspaceRoot, renamed.note.relativePath, true);
          }
          const wasActive = relativePath === activePath;
          if (wasActive) {
            set({
              activePath: renamed.note.relativePath,
              loadedContentPath: renamed.note.relativePath,
              favoritePaths,
            });
          } else {
            set({ favoritePaths });
          }
          const page = await gateways.workspace.queryLibrary(workspaceRoot, currentQuery());
          await applyLibraryPage(
            workspaceRoot,
            page,
            wasActive ? renamed.note.relativePath : undefined,
            { selectIfNeeded: wasActive },
          );
        } catch (error) {
          set({
            isLoading: false,
            error: storeT(get().settings, "errors.renameNote", { message: toMessage(error) }),
          });
        }
      },

      async renameActiveNote(newRelativePath) {
        const { activePath } = get();
        if (!activePath) return;
        await get().renameNote(activePath, newRelativePath);
      },

      async deleteNote(relativePath) {
        const { workspaceRoot, activePath, notes } = get();
        if (!workspaceRoot || !relativePath) return;
        set({ isLoading: true, error: "" });
        try {
          const note = notes.find((item) => item.relativePath === relativePath);
          await gateways.workspace.deleteNote(workspaceRoot, relativePath);
          await gateways.persistence.deleteDraft(workspaceRoot, relativePath);
          if (note?.favorite) {
            await gateways.persistence.setFavorite(workspaceRoot, relativePath, false);
          }
          const nextFavorites = get().favoritePaths.filter((path) => path !== relativePath);
          if (relativePath === activePath) {
            set({
              activePath: null,
              loadedContentPath: null,
              content: "",
              savedContent: "",
              favoritePaths: nextFavorites,
            });
          } else {
            set({ favoritePaths: nextFavorites });
          }
          const page = await gateways.workspace.queryLibrary(workspaceRoot, currentQuery());
          await applyLibraryPage(workspaceRoot, page, null, { selectIfNeeded: relativePath === activePath });
        } catch (error) {
          set({
            isLoading: false,
            error: storeT(get().settings, "errors.deleteNote", { message: toMessage(error) }),
          });
        }
      },

      async deleteActiveNote() {
        const { activePath } = get();
        if (!activePath) return;
        await get().deleteNote(activePath);
      },

      async setFolderAppearance(folder, appearance) {
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
      },

      async toggleFavorite(relativePath) {
        const { workspaceRoot, activePath, notes, favoritePaths, libraryStats, navFilter } = get();
        const path = relativePath ?? activePath;
        if (!workspaceRoot || !path) return;
        const favorite = !favoritePaths.includes(path);
        const nextFavorites = favorite
          ? [...favoritePaths, path]
          : favoritePaths.filter((item) => item !== path);
        set({
          favoritePaths: nextFavorites,
          notes: notes.map((item) =>
            item.relativePath === path ? { ...item, favorite } : item,
          ),
          libraryStats: {
            ...libraryStats,
            favorites: Math.max(0, libraryStats.favorites + (favorite ? 1 : -1)),
          },
        });
        try {
          await gateways.persistence.setFavorite(workspaceRoot, path, favorite);
          if (navFilter === "favorites") await runLibraryQuery();
        } catch (error) {
          set({
            notes,
            favoritePaths,
            libraryStats,
            error: storeT(get().settings, "errors.saveFavorite", { message: toMessage(error) }),
          });
        }
      },

      async refreshAttachments() {
        const root = get().workspaceRoot;
        if (!root) {
          set({ attachments: [] });
          return;
        }
        try {
          set({ attachments: await gateways.workspace.scanAttachments(root) });
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.loadAttachments", { message: toMessage(error) }),
          });
        }
      },

      async saveAttachments(inputs: SaveAttachmentInput[]) {
        const root = get().workspaceRoot;
        if (!root || inputs.length === 0) return [];
        try {
          const saved: AttachmentFile[] = [];
          for (const input of inputs) {
            saved.push(await gateways.workspace.saveAttachment(root, input));
          }
          set({
            attachments: mergeAttachments(get().attachments, saved),
            status: storeT(get().settings, "status.attachmentSaved"),
            error: "",
          });
          scheduleCloudSync();
          return saved;
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.saveAttachment", { message: toMessage(error) }),
          });
          return [];
        }
      },

      async savePastedImages(files: File[]) {
        const { workspaceRoot, activePath, settings } = get();
        if (!workspaceRoot) return "";
        if (!activePath) {
          set({ error: storeT(settings, "errors.pasteNeedsNote") });
          return "";
        }
        const oversized = files.find((file) => file.size > MAX_ATTACHMENT_BYTES);
        if (oversized) {
          set({ error: storeT(settings, "errors.attachmentTooLarge") });
          return "";
        }
        const inputs = await Promise.all(
          files.map(async (file) => ({
            bytesBase64: await fileToBase64(file),
            fileName: suggestedPasteFileName(file),
            mimeType: file.type,
          })),
        );
        const saved = await get().saveAttachments(inputs);
        return markdownForAttachments(get().activePath, saved);
      },

      async importDroppedImages(sourcePaths) {
        const { workspaceRoot, activePath, settings } = get();
        const paths = imagePathsFromDrop(sourcePaths);
        if (!workspaceRoot || paths.length === 0) return "";
        if (!activePath) {
          set({ error: storeT(settings, "errors.pasteNeedsNote") });
          return "";
        }
        try {
          const imported = await gateways.workspace.importAttachmentsFromPaths(
            workspaceRoot,
            paths,
          );
          if (!imported.length) return "";
          set({
            attachments: mergeAttachments(get().attachments, imported),
            status: storeT(get().settings, "status.attachmentSaved"),
            error: "",
          });
          return markdownForAttachments(get().activePath, imported);
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.importAttachment", { message: toMessage(error) }),
          });
          return "";
        }
      },

      async importAttachments() {
        const root = get().workspaceRoot;
        if (!root) return [];
        try {
          const imported = await gateways.workspace.importAttachments(root);
          if (imported.length) {
            set({
              attachments: mergeAttachments(get().attachments, imported),
              status: storeT(get().settings, "status.attachmentsImported"),
              error: "",
            });
          }
          return imported;
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.importAttachment", { message: toMessage(error) }),
          });
          return [];
        }
      },

      async deleteAttachment(relativePath) {
        const root = get().workspaceRoot;
        if (!root || !relativePath) return;
        try {
          await gateways.workspace.deleteAttachment(root, relativePath);
          set({
            attachments: get().attachments.filter((item) => item.relativePath !== relativePath),
            status: storeT(get().settings, "status.attachmentDeleted"),
            error: "",
          });
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.deleteAttachment", { message: toMessage(error) }),
          });
        }
      },

      async rebuildIndex() {
        const root = get().workspaceRoot;
        if (!root) return;
        set({ isLoading: true, error: "" });
        try {
          const page = await gateways.workspace.rebuildIndex(root, currentQuery());
          await applyLibraryPage(root, page);
          set({ status: storeT(get().settings, "status.indexRebuilt") });
        } catch (error) {
          set({
            isLoading: false,
            error: storeT(get().settings, "errors.rebuildIndex", { message: toMessage(error) }),
          });
        }
      },

      setQuery(query) {
        set({ query });
        scheduleLibraryQuery();
      },
      setNavFilter(navFilter) {
        set({ navFilter, scopedFilter: null, mobilePanel: "library", libraryPanelMode: "notes" });
        void runLibraryQuery();
      },
      setScopedFilter(scopedFilter) {
        set({ scopedFilter, navFilter: "all", mobilePanel: "library", libraryPanelMode: "notes" });
        void runLibraryQuery();
      },
      setLibraryPanelMode(libraryPanelMode) {
        set({ libraryPanelMode, mobilePanel: "library" });
      },
      setViewMode(viewMode) {
        set({ viewMode });
      },
      setSidebarCollapsed(isSidebarCollapsed) {
        set({ isSidebarCollapsed });
        persistPreferences();
      },
      setSettings(settings) {
        set({ settings: mergeSettings(settings) });
        persistPreferences();
      },
      resetSettings() {
        set({ settings: DEFAULT_SETTINGS });
        persistPreferences();
      },
      openSettings(settingsSection = "appearance") {
        set({ settingsOpen: true, settingsSection });
      },
      closeSettings() {
        set({ settingsOpen: false });
      },
      setSettingsSection(settingsSection) {
        set({ settingsSection });
      },
      async saveCloudSyncProfile(profile: CloudSyncProfileInput) {
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
      },
      async testCloudSync(profile: CloudSyncProfileInput) {
        return gateways.cloudSync.testConnection(profile);
      },
      async runCloudSync(profile?: CloudSyncProfileInput) {
        const root = get().workspaceRoot;
        if (!root) return null;
        const unsaved = isOpenUnsavedNote(get());
        const activePath = get().activePath;
        try {
          const result = await gateways.cloudSync.runSync(root, profile);
          set({
            cloudSyncProfile: mergeCloudSyncProfile(result.profile),
            status: storeT(get().settings, "status.cloudSyncComplete"),
          });
          await get().refreshWorkspace();
          if (!unsaved && activePath && get().activePath === activePath) {
            await get().selectNote(activePath);
          }
          return result;
        } catch (error) {
          set({
            error: storeT(get().settings, "errors.runCloudSync", { message: toMessage(error) }),
          });
          throw error;
        }
      },
      setMobilePanel(mobilePanel) {
        set({ mobilePanel });
      },
      clearError() {
        set({ error: "" });
      },
    };
  });

  const stopAutosave = () => {
    if (autosaveTimer !== null) {
      window.clearInterval(autosaveTimer);
      autosaveTimer = null;
    }
  };

  const syncAutosave = () => {
    if (!isOpenUnsavedNote(store.getState())) {
      stopAutosave();
      return;
    }
    if (autosaveTimer !== null) return;
    autosaveTimer = window.setInterval(() => {
      const state = store.getState();
      if (!isOpenUnsavedNote(state)) {
        stopAutosave();
        return;
      }
      if (state.isSaving) return;
      void state.saveActiveNote();
    }, AUTOSAVE_INTERVAL_MS);
  };

  store.subscribe(syncAutosave);
  return store;
}

export const useAppStore = createAppStore();
