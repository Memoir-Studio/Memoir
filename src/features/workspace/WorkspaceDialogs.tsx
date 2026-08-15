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
import { collectFolderPaths } from "../../domain/folders";
import { addUniqueTags, parseTagTokens } from "../../domain/notes";
import { dateLocale } from "../../i18n";
import { useI18n } from "../../i18n/react";
import { useAppStore } from "../../store/app-store";
import { folderName, uniqueSorted } from "../library/note-utils";

type FormDialog =
  | {
      type: "create";
      title: string;
      extension: "md" | "mdx";
      folder: string;
      tags: string[];
      tagQuery: string;
    }
  | { type: "rename"; from: string; path: string }
  | null;

type WorkspaceDialogActions = {
  openCreate: (extension?: "md" | "mdx", folder?: string, tag?: string) => void;
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
  const folderAppearances = useAppStore((state) => state.folderAppearances);
  const activePath = useAppStore((state) => state.activePath);
  const createNote = useAppStore((state) => state.createNote);
  const renameNote = useAppStore((state) => state.renameNote);
  const deleteNote = useAppStore((state) => state.deleteNote);
  const { t, locale } = useI18n();
  const folderOptions = useMemo(() => {
    const folders = collectFolderPaths(
      [...notes.map((note) => folderName(note.relativePath)), ...Object.keys(folderAppearances)],
      dateLocale(locale),
    );
    return folders.map((folder) => {
      const emoji = folderAppearances[folder]?.emoji;
      return {
        value: folder,
        label: emoji ? `${emoji} ${folder}` : folder,
      };
    });
  }, [folderAppearances, locale, notes]);
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
      openCreate: (extension = "mdx", folder = "", tag = "") => {
        setFormDialog({
          type: "create",
          title: "",
          extension,
          folder,
          tags: tag.trim() ? [tag.trim()] : [],
          tagQuery: "",
        });
      },
      openRename: (path) => {
        const target = path ?? activePath;
        if (target) setFormDialog({ type: "rename", from: target, path: target });
      },
      openDelete: (path) => {
        const target = path ?? activePath;
        if (target) setDeleteTarget(target);
      },
    }),
    [activePath],
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
    } else {
      await renameNote(formDialog.from, formDialog.path);
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
            <Button type="submit" variant="primary">
              {formDialog?.type === "rename" ? t("common.rename") : t("common.create")}
            </Button>
          </>
        }
        onClose={closeForm}
        onSubmit={() => void submitForm()}
        open={Boolean(formDialog)}
        title={formDialog?.type === "rename" ? t("dialog.renameNote") : t("dialog.newNote")}
      >
        {formDialog?.type === "create" ? (
          <div className="grid gap-3">
            <label className="memoir-field-label">
              {t("dialog.title")}
              <Input
                autoFocus
                onChange={(event) => updateCreate({ title: event.target.value })}
                value={formDialog.title}
              />
            </label>
            <label className="memoir-field-label">
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
            <div className="memoir-field-label">
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
        ) : (
          formDialog && (
            <label className="memoir-field-label">
              {t("dialog.relativePath")}
              <Input
                autoFocus
                onChange={(event) =>
                  setFormDialog({ ...formDialog, path: event.target.value })
                }
                value={formDialog.path}
              />
            </label>
          )
        )}
      </Dialog>
      <AlertDialog
        confirmLabel={t("dialog.moveToTrash")}
        description={t("dialog.deleteConfirm", {
          title:
            notes.find((note) => note.relativePath === deleteTarget)?.title ||
            deleteTarget ||
            t("dialog.currentNote"),
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
