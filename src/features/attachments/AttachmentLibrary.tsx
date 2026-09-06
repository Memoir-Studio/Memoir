import * as stylex from "@stylexjs/stylex";
import { ImagePlus, Loader2, Paperclip, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { AlertDialog, Input, Surface } from "../../components/ui";
import type { AttachmentFile } from "../../domain/attachments";
import { formatBytes, markdownImageForAttachment } from "../../domain/attachments";
import { resolveWorkspaceFilePath } from "../../domain/paths";
import { getGateways } from "../../gateways";
import { formatRelativeTime } from "../../i18n";
import { useI18n } from "../../i18n/react";
import { useAppStore } from "../../store/app-store";
import {
  accents,
  colors,
  commonStyles,
  motion,
  typography,
} from "../../styles/tokens.stylex";
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
    <div {...stylex.props(styles.root, commonStyles.fadeIn)}>
      <label {...stylex.props(styles.search)}>
        <Search {...stylex.props(styles.searchIcon)} aria-hidden />
        <Input
          aria-label={t("library.filterAttachments")}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("library.filterAttachmentsPlaceholder")}
          style={styles.searchInput}
          type="search"
          value={query}
        />
      </label>
      <div {...stylex.props(styles.summary)}>
        <span>{tc("library.attachmentCount", filtered.length)}</span>
        {isLoading ? <Loader2 {...stylex.props(styles.loader)} aria-hidden /> : null}
      </div>
      <div {...stylex.props(styles.grid)}>
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
              data-state={
                menuTarget?.path === attachment.relativePath ? "menu-open" : "idle"
              }
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
              style={[
                styles.card,
                density === "compact" ? styles.cardCompact : styles.cardComfortable,
                menuTarget?.path === attachment.relativePath && styles.cardMenuTarget,
              ]}
              tabIndex={0}
            >
              <div {...stylex.props(styles.thumbnail)}>
                {src ? (
                  <img alt="" {...stylex.props(styles.thumbnailImage)} src={src} />
                ) : (
                  <Paperclip {...stylex.props(styles.thumbnailFallback)} aria-hidden />
                )}
              </div>
              <div
                {...stylex.props(
                  styles.details,
                  density === "compact" ? styles.detailsCompact : styles.detailsComfortable,
                )}
              >
                <p {...stylex.props(styles.fileName)}>{attachment.fileName}</p>
                <p {...stylex.props(styles.metadata)}>
                  {formatBytes(attachment.size)} · {formatRelativeTime(attachment.modifiedMs, locale)}
                </p>
              </div>
            </Surface>
          );
        })}
        {!attachments.length && (
          <div {...stylex.props(styles.empty)}>
            <Paperclip {...stylex.props(styles.emptyIcon)} aria-hidden />
            <p {...stylex.props(styles.emptyTitle)}>{t("library.noAttachments")}</p>
            <p {...stylex.props(styles.emptyHint)}>
              {t("library.attachmentsEmptyHint")}
            </p>
            <button
              {...stylex.props(styles.importButton)}
              onClick={() => void importAttachments()}
              type="button"
            >
              <ImagePlus {...stylex.props(styles.importIcon)} aria-hidden />
              {t("library.importAttachment")}
            </button>
          </div>
        )}
        {attachments.length > 0 && !filtered.length && (
          <p {...stylex.props(styles.noMatches)}>
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

const spin = stylex.keyframes({
  to: { transform: "rotate(360deg)" },
});

const styles = stylex.create({
  root: {
    display: "flex",
    flex: "1 1 0%",
    flexDirection: "column",
    minHeight: 0,
  },
  search: {
    display: "block",
    marginInline: "12px",
    marginTop: "10px",
    position: "relative",
  },
  searchIcon: {
    color: colors.muted,
    height: "14px",
    left: "10px",
    pointerEvents: "none",
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    width: "14px",
    zIndex: 1,
  },
  searchInput: {
    backgroundColor: {
      default: `color-mix(in srgb, ${colors.elevated} 42%, ${colors.panel})`,
      ":hover": `color-mix(in srgb, ${colors.elevated} 72%, ${colors.panel})`,
      ":focus": `color-mix(in srgb, ${colors.elevated} 72%, ${colors.panel})`,
      ":focus-visible": `color-mix(in srgb, ${colors.elevated} 72%, ${colors.panel})`,
    },
    borderColor: {
      default: `color-mix(in srgb, ${colors.border} 54%, transparent)`,
      ":hover": `color-mix(in srgb, ${colors.border} 88%, transparent)`,
      ":focus": `color-mix(in srgb, ${colors.border} 88%, transparent)`,
      ":focus-visible": `color-mix(in srgb, ${colors.border} 88%, transparent)`,
    },
    borderRadius: "10px",
    boxShadow: {
      default: "none",
      ":hover": "0 1px 4px rgb(72 62 48 / 4%)",
      ":focus": "0 1px 4px rgb(72 62 48 / 4%)",
      ":focus-visible": "0 1px 4px rgb(72 62 48 / 4%)",
    },
    color: colors.text,
    fontFamily: typography.uiFont,
    fontSize: "12px",
    fontWeight: 450,
    height: "32px",
    letterSpacing: 0,
    paddingLeft: "32px",
    transitionDuration: motion.standard,
    transitionProperty: "background-color, border-color, box-shadow",
    transitionTimingFunction: motion.ease,
    "::placeholder": {
      color: `color-mix(in srgb, ${colors.muted} 82%, transparent)`,
      opacity: 1,
    },
  },
  summary: {
    alignItems: "center",
    color: colors.muted,
    display: "flex",
    fontFamily: typography.uiFont,
    fontSize: "11px",
    fontWeight: 500,
    justifyContent: "space-between",
    padding: "12px 16px 8px",
  },
  loader: {
    animationDuration: "1s",
    animationIterationCount: "infinite",
    animationName: spin,
    animationTimingFunction: "linear",
    height: "14px",
    width: "14px",
  },
  grid: {
    alignContent: "start",
    display: "grid",
    flex: "1 1 0%",
    gap: "8px",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    overflow: "auto",
    padding: "0 10px 12px",
  },
  card: {
    backgroundColor: {
      default: "transparent",
      ":hover": `color-mix(in srgb, ${colors.elevated} 66%, transparent)`,
      ":focus-visible": `color-mix(in srgb, ${colors.elevated} 66%, transparent)`,
    },
    borderColor: "transparent",
    borderRadius: "8px",
    boxShadow: "none",
    cursor: "pointer",
    transitionDuration: "150ms",
    transitionProperty: "background-color, box-shadow",
    transitionTimingFunction: motion.ease,
  },
  cardCompact: {
    padding: "6px",
  },
  cardComfortable: {
    padding: "8px",
  },
  cardMenuTarget: {
    backgroundColor: `color-mix(in srgb, ${colors.elevated} 78%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accents.primary} 16%, transparent)`,
  },
  thumbnail: {
    aspectRatio: "4 / 3",
    backgroundColor: colors.elevated,
    borderRadius: "6px",
    display: "grid",
    overflow: "hidden",
    placeItems: "center",
  },
  thumbnailImage: {
    height: "100%",
    objectFit: "cover",
    width: "100%",
  },
  thumbnailFallback: {
    color: colors.muted,
    height: "20px",
    width: "20px",
  },
  details: {
    minWidth: 0,
  },
  detailsCompact: {
    marginTop: "4px",
  },
  detailsComfortable: {
    marginTop: "6px",
  },
  fileName: {
    color: colors.text,
    fontFamily: typography.uiFont,
    fontSize: "12px",
    fontWeight: 600,
    margin: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  metadata: {
    color: colors.muted,
    fontFamily: typography.uiFont,
    fontSize: "10px",
    margin: "2px 0 0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  empty: {
    display: "grid",
    gridColumn: "1 / -1",
    padding: "40px 16px",
    placeItems: "center",
    textAlign: "center",
  },
  emptyIcon: {
    color: colors.muted,
    height: "20px",
    marginBottom: "8px",
    width: "20px",
  },
  emptyTitle: {
    color: colors.text,
    fontFamily: typography.uiFont,
    fontSize: "12px",
    fontWeight: 500,
    margin: 0,
  },
  emptyHint: {
    color: colors.muted,
    fontFamily: typography.uiFont,
    fontSize: "11px",
    lineHeight: "20px",
    margin: "4px 0 0",
    maxWidth: "256px",
  },
  importButton: {
    alignItems: "center",
    appearance: "none",
    backgroundColor: "transparent",
    borderWidth: 0,
    borderRadius: "8px",
    color: accents.primary,
    cursor: "pointer",
    display: "inline-flex",
    fontFamily: typography.uiFont,
    fontSize: "11px",
    fontWeight: 500,
    gap: "6px",
    margin: "12px 0 0",
    padding: "6px 10px",
  },
  importIcon: {
    height: "14px",
    width: "14px",
  },
  noMatches: {
    color: colors.muted,
    fontFamily: typography.uiFont,
    fontSize: "12px",
    gridColumn: "1 / -1",
    margin: 0,
    padding: "32px 12px",
    textAlign: "center",
  },
});
