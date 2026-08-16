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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="index-row">
      <dt>{label}</dt>
      <dd title={value}>{value}</dd>
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
    <div className="index-inspector memoir-fade-in flex min-h-0 flex-1 flex-col overflow-auto px-3 pb-4 pt-2.5">
      {busy && !info ? (
        <div className="grid flex-1 place-items-center text-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : loadError && !info ? (
        <div className="grid flex-1 place-items-center px-4 text-center">
          <Database className="mb-2 h-5 w-5 text-muted" />
          <p className="text-xs font-medium text-text">{t("library.indexLoadFailed")}</p>
          <button
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-accent"
            onClick={reload}
            type="button"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("library.indexRetry")}
          </button>
        </div>
      ) : info ? (
        <>
          <div className="index-hero rounded-xl px-3 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-[11px] text-muted" title={info.relativePath}>
                  {info.relativePath || INDEX_RELATIVE_PATH}
                </p>
                <p className="mt-1 text-[13px] font-semibold tracking-[-0.02em] text-text">
                  {formatBytes(indexTotalSize(info))}
                </p>
              </div>
              <span className={info.persistent ? "index-status" : "index-status is-memory"}>
                {info.persistent ? t("library.indexOnDisk") : t("library.indexInMemory")}
              </span>
            </div>
          </div>

          <div className="index-stat-grid mt-3">
            <div className="index-stat">
              <p className="index-stat-value tabular-nums">{info.noteCount}</p>
              <p className="index-stat-label">{t("library.indexNotes")}</p>
            </div>
            <div className="index-stat">
              <p className="index-stat-value tabular-nums">{info.tagCount}</p>
              <p className="index-stat-label">{t("library.indexTags")}</p>
            </div>
            <div className="index-stat">
              <p className="index-stat-value tabular-nums">{info.tagLinkCount}</p>
              <p className="index-stat-label">{t("library.indexTagLinks")}</p>
            </div>
            <div className="index-stat">
              <p className="index-stat-value tabular-nums">{info.truncatedCount}</p>
              <p className="index-stat-label">{t("library.indexTruncated")}</p>
            </div>
          </div>

          <dl className="index-meta mt-3">
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
            <p className="index-callout mt-3">{t("library.indexMemoryHint")}</p>
          )}
          {info.truncatedCount > 0 && (
            <p className="index-callout mt-2">
              {t("library.indexTruncatedHint", { count: info.truncatedCount })}
            </p>
          )}

          <p className="mt-3 text-[11px] leading-5 text-muted">{t("library.indexHint")}</p>

          <div className="mt-3 grid gap-1.5">
            <Button
              disabled={busy}
              onClick={() => setConfirmRebuild(true)}
              size="sm"
              variant="primary"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              {t("library.rebuildIndex")}
            </Button>
            <Button disabled={busy} onClick={reload} size="sm" variant="secondary">
              <RefreshCw className="h-3.5 w-3.5" />
              {t("library.refreshIndex")}
            </Button>
            {isTauriRuntime() && info.persistent ? (
              <Button onClick={() => void openIndexFolder()} size="sm" variant="ghost">
                <FolderOpen className="h-3.5 w-3.5" />
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
        <p className="text-sm text-muted">{t("dialog.rebuildIndexHint")}</p>
      </Dialog>
    </div>
  );
}