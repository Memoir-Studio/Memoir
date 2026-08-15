import { Copy, ExternalLink, FileText, PencilLine, Star, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../../components/ui";
import { getGateways } from "../../gateways";
import { useI18n } from "../../i18n/react";
import { useAppStore } from "../../store/app-store";

export type NoteMenuTarget = {
  x: number;
  y: number;
  path: string;
};

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

export function NoteContextMenu({
  target,
  onClose,
  onRename,
  onDelete,
}: {
  target: NoteMenuTarget | null;
  onClose: () => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
}) {
  const notes = useAppStore((state) => state.notes);
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const selectNote = useAppStore((state) => state.selectNote);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite);
  const note = notes.find((item) => item.relativePath === target?.path);
  const { t } = useI18n();

  if (!target || !note) return null;

  return (
    <ContextMenu
      label={t("menu.actions", { title: note.title })}
      onClose={onClose}
      open
      x={target.x}
      y={target.y}
    >
      <ContextMenuItem
        icon={<FileText />}
        label={t("menu.open")}
        onSelect={() => void selectNote(note.relativePath)}
      />
      <ContextMenuItem
        icon={<Star className={note.favorite ? "fill-accent" : undefined} />}
        label={note.favorite ? t("menu.unfavorite") : t("menu.favorite")}
        onSelect={() => void toggleFavorite(note.relativePath)}
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={<PencilLine />}
        label={t("menu.rename")}
        onSelect={() => onRename(note.relativePath)}
      />
      <ContextMenuItem
        icon={<Copy />}
        label={t("menu.copyPath")}
        onSelect={() => void copyText(note.relativePath)}
      />
      <ContextMenuItem
        icon={<ExternalLink />}
        label={t("menu.openInSystem")}
        onSelect={() => {
          if (!workspaceRoot) return;
          void getGateways().workspace.openPath(`${workspaceRoot}/${note.relativePath}`);
        }}
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        danger
        icon={<Trash2 />}
        label={t("menu.delete")}
        onSelect={() => onDelete(note.relativePath)}
      />
    </ContextMenu>
  );
}
