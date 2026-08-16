import { Copy, ExternalLink, ImagePlus, Trash2 } from "lucide-react";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "../../components/ui";
import type { AttachmentFile } from "../../domain/attachments";
import { mapGatewayError } from "../../domain/errors";
import { useI18n } from "../../i18n/react";
import { useAppStore } from "../../store/app-store";
import { revealWorkspaceItem } from "../workspace/workspace-utils";

export type AttachmentMenuTarget = {
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

export function AttachmentContextMenu({
  attachments,
  target,
  onClose,
  onInsert,
  onDelete,
}: {
  attachments: AttachmentFile[];
  target: AttachmentMenuTarget | null;
  onClose: () => void;
  onInsert: (attachment: AttachmentFile) => void;
  onDelete: (attachment: AttachmentFile) => void;
}) {
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const attachment = attachments.find((item) => item.relativePath === target?.path);
  const { t } = useI18n();

  if (!target || !attachment) return null;

  return (
    <ContextMenu
      label={t("menu.actions", { title: attachment.fileName })}
      onClose={onClose}
      open
      x={target.x}
      y={target.y}
    >
      <ContextMenuItem
        icon={<ImagePlus />}
        label={t("menu.insertAttachment")}
        onSelect={() => onInsert(attachment)}
      />
      <ContextMenuItem
        icon={<Copy />}
        label={t("menu.copyPath")}
        onSelect={() => void copyText(attachment.relativePath)}
      />
      <ContextMenuItem
        icon={<ExternalLink />}
        label={t("menu.openInSystem")}
        onSelect={() => {
          if (!workspaceRoot) return;
          void revealWorkspaceItem(workspaceRoot, attachment.relativePath).catch((error) => {
            useAppStore.setState({
              error: t("errors.openInSystem", { message: mapGatewayError(error).message }),
            });
          });
        }}
      />
      <ContextMenuSeparator />
      <ContextMenuItem
        danger
        icon={<Trash2 />}
        label={t("menu.delete")}
        onSelect={() => onDelete(attachment)}
      />
    </ContextMenu>
  );
}
