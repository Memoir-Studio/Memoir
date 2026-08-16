import { ClipboardPaste, Copy, Redo2, Scissors, SquareDashedMousePointer, Undo2 } from "lucide-react";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "../../components/ui";
import { useI18n } from "../../i18n/react";

export type EditorMenuTarget = {
  x: number;
  y: number;
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

export function EditorContextMenu({
  target,
  onClose,
  onUndo,
  onRedo,
  onCut,
  onCopy,
  onPaste,
  onSelectAll,
}: {
  target: EditorMenuTarget | null;
  onClose: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
}) {
  const { t } = useI18n();
  if (!target) return null;

  return (
    <ContextMenu
      autoFocus={false}
      label={t("editor.contextMenu")}
      onClose={onClose}
      open
      x={target.x}
      y={target.y}
    >
      <ContextMenuItem
        disabled={!target.canUndo}
        icon={<Undo2 />}
        label={t("editor.undo")}
        onSelect={onUndo}
      />
      <ContextMenuItem
        disabled={!target.canRedo}
        icon={<Redo2 />}
        label={t("editor.redo")}
        onSelect={onRedo}
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={!target.hasSelection}
        icon={<Scissors />}
        label={t("editor.cut")}
        onSelect={onCut}
      />
      <ContextMenuItem
        disabled={!target.hasSelection}
        icon={<Copy />}
        label={t("editor.copy")}
        onSelect={onCopy}
      />
      <ContextMenuItem icon={<ClipboardPaste />} label={t("editor.paste")} onSelect={onPaste} />
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={<SquareDashedMousePointer />}
        label={t("editor.selectAll")}
        onSelect={onSelectAll}
      />
    </ContextMenu>
  );
}
