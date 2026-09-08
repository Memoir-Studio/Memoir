import { FolderOpen, SmilePlus } from "lucide-react";
import { ContextMenu, ContextMenuItem } from "../../components/ui";
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
  onCustomize,
}: {
  target: FolderMenuTarget | null;
  onClose: () => void;
  onOpen: (folder: string) => void;
  onCustomize: (folder: string) => void;
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
        icon={<SmilePlus />}
        label={t("menu.customizeFolder")}
        onSelect={() => onCustomize(target.folder)}
      />
    </ContextMenu>
  );
}
