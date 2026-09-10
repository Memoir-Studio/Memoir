import * as stylex from "@stylexjs/stylex";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AlertDialog,
  Button,
  Combobox,
  Dialog,
  Input,
  TagInput,
} from "../../components/ui";
import { collectFolderPaths, normalizeFolderKey } from "../../domain/folders";
import { addUniqueTags, parseTagTokens } from "../../domain/notes";
import { dateLocale } from "../../i18n";
import { useI18n } from "../../i18n/react";
import { useAppStore } from "../../store/app-store";
import { folderName, noteDisplayName, resolveNoteRenamePath, uniqueSorted } from "../library/note-utils";
import { colors } from "../../styles/tokens.stylex";

type FormDialog =
  | {
      type: "create";
      title: string;
      extension: "md" | "mdx";
      folder: string;
      tags: string[];
      tagQuery: string;
    }
  | { type: "createFolder"; parent: string; name: string }
  | { type: "rename"; from: string; name: string }
  | null;

function deleteNoteTitle(
  notes: Array<{ relativePath: string; fileName: string }>,
  deleteTarget: string | null,
  fallback: string,
) {
  const note = notes.find((item) => item.relativePath === deleteTarget);
  return (note ? noteDisplayName(note) : "") || deleteTarget || fallback;
}

type WorkspaceDialogActions = {
  openCreate: (extension?: "md" | "mdx", folder?: string, tag?: string) => void;
  openCreateFolder: (parent?: string) => void;
  openRename: (path?: string) => void;
  openDelete: (path?: string) => void;
};

const WorkspaceDialogsContext = createContext<WorkspaceDialogActions | null>(null);

export function useWorkspaceDialogs() {
  const actions = useContext(WorkspaceDialogsContext);
  if (!actions) {
    throw new Error("useWorkspaceDialogs must be used within WorkspaceDialogsProvider.");
  }
  return actions;
}

export function WorkspaceDialogsProvider({ children }: { children: ReactNode }) {
  const notes = useAppStore((state) => state.notes);
  const libraryFolders = useAppStore((state) => state.libraryStats.folders);
  const folderAppearances = useAppStore((state) => state.folderAppearances);
  const activePath = useAppStore((state) => state.activePath);
  const scopedFilter = useAppStore((state) => state.scopedFilter);
  const createNote = useAppStore((state) => state.createNote);
  const createFolder = useAppStore((state) => state.createFolder);
  const renameNote = useAppStore((state) => state.renameNote);
  const deleteNote = useAppStore((state) => state.deleteNote);
  const { t, locale } = useI18n();
  const folderOptions = useMemo(() => {
    const folders = collectFolderPaths(
      [
        ...libraryFolders.map((item) => item.folder),
        ...notes.map((note) => folderName(note.relativePath)),
        ...Object.keys(folderAppearances),
      ],
      dateLocale(locale),
    );
    return folders.map((folder) => {
      const emoji = folderAppearances[folder]?.emoji;
      return {
        value: folder,
        label: emoji ? `${emoji} ${folder}` : folder,
      };
    });
  }, [folderAppearances, libraryFolders, locale, notes]);
  const tagOptions = useMemo(
    () =>
      uniqueSorted(
        notes.flatMap((note) => note.tags),
        dateLocale(locale),
      ).map((tag) => ({ value: tag, label: tag })),
    [locale, notes],
  );
  const [formDialog, setFormDialog] = useState<FormDialog>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const updateCreate = (
    patch: Partial<Extract<FormDialog, { type: "create" }>>,
  ) => {
    setFormDialog((current) =>
      current?.type === "create" ? { ...current, ...patch } : current,
    );
  };
  const actions = useMemo<WorkspaceDialogActions>(
    () => ({
      openCreate: (extension = "mdx", folder, tag = "") => {
        const selectedFolder =
          typeof folder === "string"
            ? folder
            : scopedFilter?.type === "folder"
              ? scopedFilter.value
              : "";
        setFormDialog({
          type: "create",
          title: "",
          extension: extension === "md" || extension === "mdx" ? extension : "mdx",
          folder: selectedFolder,
          tags: typeof tag === "string" && tag.trim() ? [tag.trim()] : [],
          tagQuery: "",
        });
      },
      openCreateFolder: (parent = "") => {
        setFormDialog({
          type: "createFolder",
          parent: normalizeFolderKey(typeof parent === "string" ? parent : ""),
          name: "",
        });
      },
      openRename: (path) => {
        const target = typeof path === "string" && path ? path : activePath;
        if (target) {
          const fileName = target.split("/").pop() || target;
          setFormDialog({ type: "rename", from: target, name: fileName });
        }
      },
      openDelete: (path) => {
        const target = typeof path === "string" && path ? path : activePath;
        if (target) setDeleteTarget(target);
      },
    }),
    [activePath, scopedFilter],
  );

  const closeForm = useCallback(() => setFormDialog(null), []);
  const submitForm = async () => {
    if (!formDialog) return;
    if (formDialog.type === "create") {
      const title =
        formDialog.title.trim() ||
        (formDialog.extension === "mdx" ? t("create.untitledMdx") : t("create.untitledNote"));
      const tags = addUniqueTags(formDialog.tags, parseTagTokens(formDialog.tagQuery));
      await createNote({
        title,
        extension: formDialog.extension,
        folder: formDialog.folder.trim() || undefined,
        tags: tags.length ? tags : undefined,
      });
    } else if (formDialog.type === "createFolder") {
      const name = formDialog.name.trim();
      if (!name) return;
      await createFolder(normalizeFolderKey(`${formDialog.parent}/${name}`));
    } else {
      await renameNote(formDialog.from, resolveNoteRenamePath(formDialog.from, formDialog.name));
    }
    closeForm();
  };

  return (
    <WorkspaceDialogsContext.Provider value={actions}>
      {children}
      <Dialog
        footer={
          <>
            <Button onClick={closeForm}>{t("common.cancel")}</Button>
            <Button
              disabled={formDialog?.type === "createFolder" && !formDialog.name.trim()}
              type="submit"
              variant="primary"
            >
              {formDialog?.type === "rename" ? t("common.rename") : t("common.create")}
            </Button>
          </>
        }
        onClose={closeForm}
        onSubmit={() => void submitForm()}
        open={Boolean(formDialog)}
        title={
          formDialog?.type === "rename"
            ? t("dialog.renameNote")
            : formDialog?.type === "createFolder"
              ? t("dialog.newFolder")
              : t("dialog.newNote")
        }
      >
        {formDialog?.type === "create" ? (
          <div {...stylex.props(styles.form)}>
            <label {...stylex.props(styles.label)}>
              {t("dialog.title")}
              <Input
                autoFocus
                onChange={(event) => updateCreate({ title: event.target.value })}
                value={formDialog.title}
              />
            </label>
            <label {...stylex.props(styles.label)}>
              {t("dialog.folderOptional")}
              <Combobox
                allowCreate
                createLabel={(name) => t("dialog.folderCreate", { name })}
                emptyLabel={t("dialog.folderEmpty")}
                label={t("dialog.folderOptional")}
                onChange={(folder) => updateCreate({ folder })}
                options={folderOptions}
                placeholder={t("dialog.folderPlaceholder")}
                value={formDialog.folder}
              />
            </label>
            <div {...stylex.props(styles.label)}>
              {t("dialog.tagOptional")}
              <TagInput
                allowCreate
                createLabel={(name) => t("dialog.tagCreate", { name })}
                emptyLabel={t("dialog.tagEmpty")}
                label={t("dialog.tagOptional")}
                onChange={(tags) => updateCreate({ tags })}
                onQueryChange={(tagQuery) => updateCreate({ tagQuery })}
                options={tagOptions}
                placeholder={t("dialog.tagPlaceholder")}
                query={formDialog.tagQuery}
                removeLabel={(name) => t("dialog.removeTag", { name })}
                value={formDialog.tags}
              />
            </div>
          </div>
        ) : formDialog?.type === "createFolder" ? (
          <div {...stylex.props(styles.form)}>
            {formDialog.parent && (
              <div {...stylex.props(styles.folderParent)}>
                <span>{t("dialog.folderParent")}</span>
                <strong {...stylex.props(styles.folderParentPath)}>{formDialog.parent}</strong>
              </div>
            )}
            <label {...stylex.props(styles.label)}>
              {t("dialog.folderName")}
              <Input
                autoFocus
                onChange={(event) =>
                  setFormDialog({ ...formDialog, name: event.target.value })
                }
                placeholder={t("dialog.folderNamePlaceholder")}
                value={formDialog.name}
              />
            </label>
          </div>
        ) : (
          formDialog?.type === "rename" && (
            <label {...stylex.props(styles.label)}>
              {t("dialog.fileName")}
              <Input
                autoFocus
                onChange={(event) =>
                  setFormDialog({ ...formDialog, name: event.target.value })
                }
                value={formDialog.name}
              />
            </label>
          )
        )}
      </Dialog>
      <AlertDialog
        confirmLabel={t("dialog.moveToTrash")}
        description={t("dialog.deleteConfirm", {
          title: deleteNoteTitle(notes, deleteTarget, t("dialog.currentNote")),
        })}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deleteNote(deleteTarget);
        }}
        open={Boolean(deleteTarget)}
        title={t("dialog.deleteNote")}
      />
    </WorkspaceDialogsContext.Provider>
  );
}

const styles = stylex.create({
  form: {
    display: "grid",
    gap: 12,
  },
  label: {
    display: "grid",
    gap: 7,
    color: colors.muted,
    fontSize: 12,
    fontWeight: 550,
    letterSpacing: 0,
  },
  folderParent: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minWidth: 0,
    color: colors.muted,
    fontSize: 12,
    letterSpacing: 0,
  },
  folderParentPath: {
    minWidth: 0,
    overflow: "hidden",
    color: colors.text,
    fontWeight: 600,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});
