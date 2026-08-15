import { ImagePlus, Loader2, Paperclip, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AlertDialog, Input, Surface, cn } from "../../components/ui";
import type { AttachmentFile } from "../../domain/attachments";
import { formatBytes, markdownImageForAttachment } from "../../domain/attachments";
import { resolveWorkspaceFilePath } from "../../domain/paths";
import { getGateways } from "../../gateways";
import { formatRelativeTime } from "../../i18n";
import { useI18n } from "../../i18n/react";
import { useAppStore } from "../../store/app-store";
import {
  AttachmentContextMenu,
  type AttachmentMenuTarget,
} from "./AttachmentContextMenu";

export function AttachmentLibrary({
  onInsert,
}: {
  onInsert?: (markdown: string) => void;
}) {
  const attachments = useAppStore((state) => state.attachments);
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const activePath = useAppStore((state) => state.activePath);
  const isLoading = useAppStore((state) => state.isLoading);
  const density = useAppStore((state) => state.settings.appearance.density);
  const importAttachments = useAppStore((state) => state.importAttachments);
  const deleteAttachment = useAppStore((state) => state.deleteAttachment);
  const { t, tc, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [menuTarget, setMenuTarget] = useState<AttachmentMenuTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AttachmentFile | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return attachments;
    return attachments.filter((item) => item.fileName.toLowerCase().includes(needle));
  }, [attachments, query]);

  const insertAttachment = (attachment: AttachmentFile) => {
    if (!activePath) {
      useAppStore.setState({ error: t("errors.pasteNeedsNote") });
      return;
    }
    onInsert?.(markdownImageForAttachment(activePath, attachment));
  };

  return (
    <div className="memoir-fade-in flex min-h-0 flex-1 flex-col">
      <label className="note-search relative mx-3 mt-2.5 block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
        <Input
          aria-label={t("library.filterAttachments")}
          className="h-8 rounded-[10px] pl-8 shadow-none"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("library.filterAttachmentsPlaceholder")}
          type="search"
          value={query}
        />
      </label>
      <div className="flex items-center justify-between px-4 pb-2 pt-3 text-[11px] font-medium text-muted">
        <span>{tc("library.attachmentCount", filtered.length)}</span>
        {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      </div>
      <div className="attachment-grid grid flex-1 content-start gap-2 overflow-auto px-2.5 pb-3">
        {filtered.map((attachment) => {
          const src = workspaceRoot
            ? getGateways().workspace.resolveMediaPath(
                resolveWorkspaceFilePath(workspaceRoot, attachment.relativePath),
              )
            : "";
          return (
            <Surface
              aria-expanded={menuTarget?.path === attachment.relativePath}
              aria-haspopup="menu"
              aria-label={attachment.fileName}
              className={cn(
                "attachment-card group cursor-pointer rounded-lg border-transparent bg-transparent shadow-none",
                density === "compact" ? "p-1.5" : "p-2",
                menuTarget?.path === attachment.relativePath && "is-menu-target",
              )}
              key={attachment.relativePath}
              onClick={() => insertAttachment(attachment)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMenuTarget({
                  x: event.clientX,
                  y: event.clientY,
                  path: attachment.relativePath,
                });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  insertAttachment(attachment);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="attachment-thumb overflow-hidden rounded-md bg-elevated">
                {src ? (
                  <img alt="" className="h-full w-full object-cover" src={src} />
                ) : (
                  <Paperclip className="h-5 w-5 text-muted" />
                )}
              </div>
              <div className={cn("min-w-0", density === "compact" ? "mt-1" : "mt-1.5")}>
                <p className="truncate text-[12px] font-semibold text-text">{attachment.fileName}</p>
                <p className="mt-0.5 truncate text-[10px] text-muted">
                  {formatBytes(attachment.size)} · {formatRelativeTime(attachment.modifiedMs, locale)}
                </p>
              </div>
            </Surface>
          );
        })}
        {!attachments.length && (
          <div className="col-span-full grid place-items-center px-4 py-10 text-center">
            <Paperclip className="mb-2 h-5 w-5 text-muted" />
            <p className="text-xs font-medium text-text">{t("library.noAttachments")}</p>
            <p className="mt-1 max-w-[16rem] text-[11px] leading-5 text-muted">
              {t("library.attachmentsEmptyHint")}
            </p>
            <button
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-accent"
              onClick={() => void importAttachments()}
              type="button"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              {t("library.importAttachment")}
            </button>
          </div>
        )}
        {attachments.length > 0 && !filtered.length && (
          <p className="col-span-full px-3 py-8 text-center text-xs text-muted">
            {t("library.noAttachmentMatches")}
          </p>
        )}
      </div>
      <AttachmentContextMenu
        attachments={attachments}
        onClose={() => setMenuTarget(null)}
        onDelete={(attachment) => setDeleteTarget(attachment)}
        onInsert={insertAttachment}
        target={menuTarget}
      />
      <AlertDialog
        confirmLabel={t("dialog.moveToTrash")}
        description={t("dialog.deleteAttachmentConfirm", {
          name: deleteTarget?.fileName || "",
        })}
        hint={t("dialog.recycleAttachmentHint")}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deleteAttachment(deleteTarget.relativePath);
        }}
        open={Boolean(deleteTarget)}
        title={t("dialog.deleteAttachment")}
      />
    </div>
  );
}
