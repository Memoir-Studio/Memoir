import * as stylex from "@stylexjs/stylex";
import { Check, Database, FolderOpen, Loader2, RefreshCw, RotateCcw, Sparkles } from "lucide-react";
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
import type { VectorIndexStatus } from "../../domain/vector-index";
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
  const aiSettings = useAppStore((state) => state.settings.ai);
  const { t, locale } = useI18n();
  const [info, setInfo] = useState<WorkspaceIndexInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [vectorInfo, setVectorInfo] = useState<VectorIndexStatus | null>(null);
  const [vectorBusy, setVectorBusy] = useState(false);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    if (!workspaceRoot) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    void Promise.all([
      getGateways().workspace.getIndexInfo(workspaceRoot),
      getGateways().workspace.getVectorIndexStatus(workspaceRoot, aiSettings),
    ])
      .then(([next, vector]) => {
        if (!cancelled) {
          setInfo(next);
          setVectorInfo(vector);
        }
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
  }, [aiSettings, reloadToken, t, workspaceRoot]);

  const openIndexFolder = async () => {
    if (!workspaceRoot) return;
    try {
      await getGateways().system.revealPath(
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

  const runVectorIndex = async (force: boolean) => {
    if (!workspaceRoot || !aiSettings.enabled) return;
    setVectorBusy(true);
    try {
      const next = await getGateways().workspace.indexVectorWorkspace(workspaceRoot, aiSettings, force);
      setVectorInfo(next);
    } catch (error) {
      useAppStore.setState({
        error: t("errors.vectorIndex", { message: mapGatewayError(error).message }),
      });
    } finally {
      setVectorBusy(false);
      reload();
    }
  };

  const busy = loading || isLoadingWorkspace || vectorBusy;
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
              <div {...stylex.props(indexStyles.heroIdentity)}>
                <div {...stylex.props(indexStyles.heroIcon)}>
                  <Database {...stylex.props(sharedLibraryStyles.icon)} />
                </div>
                <div {...stylex.props(sharedLibraryStyles.minWidth)}>
                  <p {...stylex.props(indexStyles.eyebrow)}>{t("library.indexOverview")}</p>
                  <p {...stylex.props(indexStyles.path)} title={info.relativePath}>
                    {info.relativePath || INDEX_RELATIVE_PATH}
                  </p>
                </div>
              </div>
              <span {...stylex.props(indexStyles.status, !info.persistent && indexStyles.statusMemory)}>
                {info.persistent ? t("library.indexOnDisk") : t("library.indexInMemory")}
              </span>
            </div>
            <div {...stylex.props(indexStyles.heroSummary)}>
              <div {...stylex.props(indexStyles.summaryMetric)}>
                <p {...stylex.props(indexStyles.size)}>{formatBytes(indexTotalSize(info))}</p>
                <span {...stylex.props(indexStyles.summaryLabel)}>{t("library.indexSize")}</span>
              </div>
              <span {...stylex.props(indexStyles.summaryHint)}>{t("library.indexHint")}</span>
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

          <section {...stylex.props(indexStyles.vectorSection)}>
            <div {...stylex.props(indexStyles.vectorHeader)}>
              <div {...stylex.props(indexStyles.vectorIdentity)}>
                <div {...stylex.props(indexStyles.vectorIcon)}>
                  <Sparkles {...stylex.props(sharedLibraryStyles.iconSmall)} />
                </div>
                <div {...stylex.props(sharedLibraryStyles.minWidth)}>
                  <h3 {...stylex.props(indexStyles.vectorTitle)}>{t("library.vectorIndex")}</h3>
                  <p {...stylex.props(indexStyles.vectorModel)}>
                    {vectorInfo?.model || aiSettings.embeddingModel}
                    {vectorInfo?.dimensions ? ` · ${vectorInfo.dimensions}D` : ""}
                  </p>
                </div>
              </div>
              <span {...stylex.props(indexStyles.status, !aiSettings.enabled && indexStyles.statusMemory)}>
                {aiSettings.enabled ? t("library.vectorEnabled") : t("library.vectorDisabled")}
              </span>
            </div>
            <div {...stylex.props(indexStyles.vectorStats)}>
              <InfoRow label={t("library.vectorIndexedNotes")} value={`${vectorInfo?.indexedNotes ?? 0} / ${vectorInfo?.totalNotes ?? info.noteCount}`} />
              <InfoRow label={t("library.vectorChunks")} value={String(vectorInfo?.chunkCount ?? 0)} />
              <InfoRow label={t("library.vectorPending")} value={String(vectorInfo?.pendingNotes ?? info.noteCount)} />
              <InfoRow label={t("library.vectorFailed")} value={String(vectorInfo?.failedNotes ?? 0)} />
              <InfoRow label={t("library.vectorUpdated")} value={timestamp(vectorInfo?.lastIndexedMs ?? 0)} />
            </div>
            {vectorInfo?.lastError ? (
              <p {...stylex.props(indexStyles.callout)}>{vectorInfo.lastError}</p>
            ) : null}
            <div {...stylex.props(indexStyles.vectorActions)}>
              <Button disabled={busy || !aiSettings.enabled} onClick={() => void runVectorIndex(false)} size="sm" variant="primary">
                {vectorBusy ? <Loader2 {...stylex.props(sharedLibraryStyles.iconSmall, sharedLibraryStyles.spin)} /> : <Sparkles {...stylex.props(sharedLibraryStyles.iconSmall)} />}
                {t("library.updateVectorIndex")}
              </Button>
              <Button disabled={busy || !aiSettings.enabled} onClick={() => void runVectorIndex(true)} size="sm" variant="secondary">
                <RotateCcw {...stylex.props(sharedLibraryStyles.iconSmall)} />
                {t("library.rebuildVectorIndex")}
              </Button>
            </div>
          </section>

          <section {...stylex.props(indexStyles.detailsSection)}>
            <div {...stylex.props(indexStyles.sectionHeader)}>
              <h3 {...stylex.props(indexStyles.sectionTitle)}>{t("library.indexDetails")}</h3>
              <Check {...stylex.props(indexStyles.sectionIcon)} />
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
          </section>

          {!info.persistent && (
            <p {...stylex.props(indexStyles.callout, indexStyles.marginTop)}>{t("library.indexMemoryHint")}</p>
          )}
          {info.truncatedCount > 0 && (
            <p {...stylex.props(indexStyles.callout, indexStyles.smallMarginTop)}>
              {t("library.indexTruncatedHint", { count: info.truncatedCount })}
            </p>
          )}

          <div {...stylex.props(indexStyles.actions, indexStyles.footerActions)}>
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
