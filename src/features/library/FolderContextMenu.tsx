import { FilePlus, FolderOpen, FolderPlus, SmilePlus, PencilLine, Trash2 } from "lucide-react";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "../../components/ui";
import { useI18n } from "../../i18n/react";

export type FolderMenuTarget = {
  x: number;
  y: number;
  folder: string;
  label: string;
};

export function FolderContextMenu({
  target,
  onClose,
  onOpen,
  onCreate,
  onCreateNote,
  onCustomize,
  onRename,
  onDelete,
}: {
  target: FolderMenuTarget | null;
  onClose: () => void;
  onOpen: (folder: string) => void;
  onCreate: (folder: string) => void;
  onCreateNote: (folder: string) => void;
  onCustomize: (folder: string) => void;
  onRename?: (folder: string) => void;
  onDelete?: (folder: string) => void;
}) {
  const { t } = useI18n();
  if (!target) return null;

  return (
    <ContextMenu
      label={t("menu.actions", { title: target.label })}
      onClose={onClose}
      open
      x={target.x}
      y={target.y}
    >
      <ContextMenuItem
        icon={<FolderOpen />}
        label={t("menu.openFolder")}
        onSelect={() => onOpen(target.folder)}
      />
      <ContextMenuItem
        icon={<FolderPlus />}
        label={t("nav.newFolder")}
        onSelect={() => onCreate(target.folder)}
      />
      <ContextMenuItem
        icon={<FilePlus />}
        label={t("library.newNote")}
        onSelect={() => onCreateNote(target.folder)}
      />
      <ContextMenuItem
        icon={<SmilePlus />}
        label={t("menu.customizeFolder")}
        onSelect={() => onCustomize(target.folder)}
      />
      {target.folder && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem icon={<PencilLine />} label={t("menu.rename")} onSelect={() => onRename?.(target.folder)} />
          <ContextMenuItem danger icon={<Trash2 />} label={t("menu.delete")} onSelect={() => onDelete?.(target.folder)} />
        </>
      )}
    </ContextMenu>
  );
}
