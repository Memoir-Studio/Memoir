import * as stylex from "@stylexjs/stylex";
import { Database, FolderOpen, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Dialog } from "../../components/ui";
import { formatBytes } from "../../domain/attachments";
import { mapGatewayError } from "../../domain/errors";
import {
  INDEX_RELATIVE_PATH,
  indexTotalSize,
  type WorkspaceIndexInfo,
} from "../../domain/index-info";
import { resolveWorkspaceFilePath } from "../../domain/paths";
import { getGateways } from "../../gateways";
import { formatRelativeTime } from "../../i18n";
import { useI18n } from "../../i18n/react";
import { isTauriRuntime } from "../../platform/runtime";
import { useAppStore } from "../../store/app-store";
import { indexStyles, sharedLibraryStyles } from "./library-styles.stylex";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div {...stylex.props(indexStyles.row)}>
      <dt {...stylex.props(indexStyles.rowLabel)}>{label}</dt>
      <dd {...stylex.props(indexStyles.rowValue)} title={value}>{value}</dd>
    </div>
  );
}

export function IndexInspector() {
  const workspaceRoot = useAppStore((state) => state.workspaceRoot);
  const isLoadingWorkspace = useAppStore((state) => state.isLoading);
  const rebuildIndex = useAppStore((state) => state.rebuildIndex);
  const { t, locale } = useI18n();
  const [info, setInfo] = useState<WorkspaceIndexInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [confirmRebuild, setConfirmRebuild] = useState(false);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (!workspaceRoot) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    void getGateways()
      .workspace.getIndexInfo(workspaceRoot)
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch((error) => {
        if (!cancelled) {
          setInfo(null);
          setLoadError(mapGatewayError(error).message);
          useAppStore.setState({
            error: t("errors.loadIndex", { message: mapGatewayError(error).message }),
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken, t, workspaceRoot]);

  const openIndexFolder = async () => {
    if (!workspaceRoot) return;
    try {
      await getGateways().workspace.revealPath(
        resolveWorkspaceFilePath(workspaceRoot, INDEX_RELATIVE_PATH),
      );
    } catch (error) {
      useAppStore.setState({
        error: t("errors.openIndexFolder", { message: mapGatewayError(error).message }),
      });
    }
  };

  const confirmAndRebuild = async () => {
    setConfirmRebuild(false);
    await rebuildIndex();
    reload();
  };

  const busy = loading || isLoadingWorkspace;
  const timestamp = (ms: number) => (ms ? formatRelativeTime(ms, locale) : t("library.indexNever"));

  return (
    <div {...stylex.props(indexStyles.inspector, sharedLibraryStyles.fadeIn)}>
      {busy && !info ? (
        <div {...stylex.props(indexStyles.center)}>
          <Loader2 {...stylex.props(indexStyles.errorIcon, sharedLibraryStyles.spin)} />
        </div>
      ) : loadError && !info ? (
        <div {...stylex.props(indexStyles.error)}>
          <Database {...stylex.props(indexStyles.errorIcon)} />
          <p {...stylex.props(indexStyles.errorTitle)}>{t("library.indexLoadFailed")}</p>
          <button
            onClick={reload}
            type="button"
            {...stylex.props(indexStyles.retry)}
          >
            <RefreshCw {...stylex.props(sharedLibraryStyles.iconSmall)} />
            {t("library.indexRetry")}
          </button>
        </div>
      ) : info ? (
        <>
          <div {...stylex.props(indexStyles.hero)}>
            <div {...stylex.props(indexStyles.heroRow)}>
              <div {...stylex.props(sharedLibraryStyles.minWidth)}>
                <p {...stylex.props(indexStyles.path)} title={info.relativePath}>
                  {info.relativePath || INDEX_RELATIVE_PATH}
                </p>
                <p {...stylex.props(indexStyles.size)}>
                  {formatBytes(indexTotalSize(info))}
                </p>
              </div>
              <span {...stylex.props(indexStyles.status, !info.persistent && indexStyles.statusMemory)}>
                {info.persistent ? t("library.indexOnDisk") : t("library.indexInMemory")}
              </span>
            </div>
          </div>

          <div {...stylex.props(indexStyles.statGrid)}>
            <div {...stylex.props(indexStyles.stat)}>
              <p {...stylex.props(indexStyles.statValue)}>{info.noteCount}</p>
              <p {...stylex.props(indexStyles.statLabel)}>{t("library.indexNotes")}</p>
            </div>
            <div {...stylex.props(indexStyles.stat)}>
              <p {...stylex.props(indexStyles.statValue)}>{info.tagCount}</p>
              <p {...stylex.props(indexStyles.statLabel)}>{t("library.indexTags")}</p>
            </div>
            <div {...stylex.props(indexStyles.stat)}>
              <p {...stylex.props(indexStyles.statValue)}>{info.tagLinkCount}</p>
              <p {...stylex.props(indexStyles.statLabel)}>{t("library.indexTagLinks")}</p>
            </div>
            <div {...stylex.props(indexStyles.stat)}>
              <p {...stylex.props(indexStyles.statValue)}>{info.noteLinkCount}</p>
              <p {...stylex.props(indexStyles.statLabel)}>{t("library.indexNoteLinks")}</p>
            </div>
            <div {...stylex.props(indexStyles.stat)}>
              <p {...stylex.props(indexStyles.statValue)}>{info.truncatedCount}</p>
              <p {...stylex.props(indexStyles.statLabel)}>{t("library.indexTruncated")}</p>
            </div>
          </div>

          <dl {...stylex.props(indexStyles.meta)}>
            <InfoRow label={t("library.indexPath")} value={info.relativePath} />
            <InfoRow label={t("library.indexSize")} value={formatBytes(info.fileSize)} />
            <InfoRow label={t("library.indexWal")} value={formatBytes(info.walSize)} />
            <InfoRow
              label={t("library.indexSchema")}
              value={`${info.schemaName} v${info.schemaVersion}`}
            />
            <InfoRow label={t("library.indexParseAlgo")} value={`v${info.parseAlgoVersion}`} />
            <InfoRow label={t("library.indexReadCap")} value={formatBytes(info.indexReadCap)} />
            <InfoRow label={t("library.indexCreated")} value={timestamp(info.createdMs)} />
            <InfoRow label={t("library.indexReconciled")} value={timestamp(info.lastReconcileMs)} />
          </dl>

          {!info.persistent && (
            <p {...stylex.props(indexStyles.callout, indexStyles.marginTop)}>{t("library.indexMemoryHint")}</p>
          )}
          {info.truncatedCount > 0 && (
            <p {...stylex.props(indexStyles.callout, indexStyles.smallMarginTop)}>
              {t("library.indexTruncatedHint", { count: info.truncatedCount })}
            </p>
          )}

          <p {...stylex.props(indexStyles.hint)}>{t("library.indexHint")}</p>

          <div {...stylex.props(indexStyles.actions)}>
            <Button
              disabled={busy}
              onClick={() => setConfirmRebuild(true)}
              size="sm"
              variant="primary"
            >
              {busy ? (
                <Loader2 {...stylex.props(sharedLibraryStyles.iconSmall, sharedLibraryStyles.spin)} />
              ) : (
                <RotateCcw {...stylex.props(sharedLibraryStyles.iconSmall)} />
              )}
              {t("library.rebuildIndex")}
            </Button>
            <Button disabled={busy} onClick={reload} size="sm" variant="secondary">
              <RefreshCw {...stylex.props(sharedLibraryStyles.iconSmall)} />
              {t("library.refreshIndex")}
            </Button>
            {isTauriRuntime() && info.persistent ? (
              <Button onClick={() => void openIndexFolder()} size="sm" variant="ghost">
                <FolderOpen {...stylex.props(sharedLibraryStyles.iconSmall)} />
                {t("library.openIndexFolder")}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}

      <Dialog
        description={t("dialog.rebuildIndexConfirm")}
        footer={
          <>
            <Button onClick={() => setConfirmRebuild(false)}>{t("common.cancel")}</Button>
            <Button type="submit" variant="primary">
              {t("dialog.rebuildIndexAction")}
            </Button>
          </>
        }
        onClose={() => setConfirmRebuild(false)}
        onSubmit={() => {
          void confirmAndRebuild();
        }}
        open={confirmRebuild}
        title={t("dialog.rebuildIndex")}
      >
        <p {...stylex.props(indexStyles.dialogHint)}>{t("dialog.rebuildIndexHint")}</p>
      </Dialog>
    </div>
  );
}
