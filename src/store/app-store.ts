import { create } from "zustand";
import type { AppGateways } from "../gateways/contracts";
import { getGateways } from "../gateways";
import {
  fileToBase64,
  markdownForAttachments,
  MAX_ATTACHMENT_BYTES,
  suggestedPasteFileName,
  type AttachmentFile,
  type SaveAttachmentInput,
} from "../domain/attachments";
import { DEFAULT_SETTINGS, mergeSettings, type AppSettings } from "../domain/settings";
import {
  folderAppearancesForWorkspace,
  normalizeFolderAppearance,
  normalizeFolderKey,
} from "../domain/folders";
import { mapGatewayError } from "../domain/errors";
import type { NoteMeta, RawNoteFile } from "../domain/notes";
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

    return {
      workspaceRoot: null,
      recentWorkspaces: [],
      notes: [],
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
            folderAppearances: workspaceRoot
              ? folderAppearancesForWorkspace(appState.folderAppearances, workspaceRoot)
              : {},
          });
          if (workspaceRoot) {
            await get().refreshWorkspace();
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
            await get().refreshWorkspace();
            return;
          }
          set({
            workspaceRoot,
            recentWorkspaces,
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
          await get().refreshWorkspace();
        } catch (error) {
          set({
            isLoading: false,
            error: storeT(get().settings, "errors.openWorkspace", { message: toMessage(error) }),
          });
        }
      },

      async refreshWorkspace(preferredPath) {
        const root = get().workspaceRoot;
        if (!root) return;
        set({ isLoading: true, error: "" });
        try {
          const [files, appState, attachments] = await Promise.all([
            gateways.workspace.scanWorkspace(root),
            gateways.persistence.loadAppState(),
            gateways.workspace.scanAttachments(root),
          ]);
          const draftPaths = await gateways.persistence.draftsExist(
            root,
            files.map((file) => file.relativePath),
          );
          const notes = await assembleNotes(
            gateways,
            root,
            files,
            favoriteSet(appState.favorites, root),
            draftPaths,
          );
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
          const preferred =
            preferredPath && overlaid.some((note) => note.relativePath === preferredPath)
              ? preferredPath
              : null;
          const selected =
            preferred ??
            (current.activePath && overlaid.some((note) => note.relativePath === current.activePath)
              ? current.activePath
              : null) ??
            overlaid[0]?.relativePath ??
            null;
          const alreadyOpen = selected !== null && current.loadedContentPath === selected;
          set({
            notes: overlaid,
            attachments,
            folderAppearances: folderAppearancesForWorkspace(appState.folderAppearances, root),
            activePath: selected,
            isLoading: false,
            status: tc(storeLocale(get().settings), "status.noteCount", overlaid.length),
          });
          if (selected && !alreadyOpen) await get().selectNote(selected);
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
          const relativePath = await gateways.workspace.createNote({ root, ...input });
          await get().refreshWorkspace(relativePath);
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
            await gateways.persistence.writeDraft(workspaceRoot, renamed, nextDraft);
          }
          if (note?.favorite) {
            await gateways.persistence.setFavorite(workspaceRoot, relativePath, false);
            await gateways.persistence.setFavorite(workspaceRoot, renamed, true);
          }
          const wasActive = relativePath === activePath;
          if (wasActive) {
            set({ activePath: renamed, loadedContentPath: renamed });
          }
          await get().refreshWorkspace(wasActive ? renamed : undefined);
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
          if (relativePath === activePath) {
            set({ activePath: null, loadedContentPath: null, content: "", savedContent: "" });
          }
          await get().refreshWorkspace();
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
        const { workspaceRoot, activePath, notes } = get();
        const path = relativePath ?? activePath;
        if (!workspaceRoot || !path) return;
        const note = notes.find((item) => item.relativePath === path);
        if (!note) return;
        const favorite = !note.favorite;
        set({
          notes: notes.map((item) =>
            item.relativePath === path ? { ...item, favorite } : item,
          ),
        });
        try {
          await gateways.persistence.setFavorite(workspaceRoot, path, favorite);
        } catch (error) {
          set({
            notes,
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

      setQuery(query) {
        set({ query });
      },
      setNavFilter(navFilter) {
        set({ navFilter, scopedFilter: null, mobilePanel: "library", libraryPanelMode: "notes" });
      },
      setScopedFilter(scopedFilter) {
        set({ scopedFilter, navFilter: "all", mobilePanel: "library", libraryPanelMode: "notes" });
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
