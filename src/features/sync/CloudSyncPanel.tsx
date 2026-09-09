import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Cloud, Loader2, RefreshCw, Settings2 } from "lucide-react";
import { Button, IconButton, Input, SegmentedControl, Select, Toggle } from "../../components/ui";
import {
  cloudSyncProgressRatio,
  hasCloudSyncCredentials,
  mergeCloudSyncProfile,
  toCloudSyncProfileInput,
  type CloudProviderId,
  type CloudSyncProfile,
  type CloudSyncProgress,
} from "../../domain/cloud-sync";
import { mapGatewayError } from "../../domain/errors";
import { formatRelativeTime, formatSyncDuration } from "../../i18n";
import { useI18n } from "../../i18n/react";
import type { MessageKey, MessageParams } from "../../i18n/translate";
import { isTauriRuntime } from "../../platform/runtime";
import { useAppStore } from "../../store/app-store";
import { handleWindowDragMouseDown } from "../window/window-drag";
import { accents, colors, commonStyles, media, motion } from "../../styles/tokens.stylex";

type SyncSection = "status" | "setup";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label {...stylex.props(styles.field)}>
      <span>{label}</span>
      {children}
      {hint ? <span {...stylex.props(styles.rowDescription)}>{hint}</span> : null}
    </label>
  );
}

function progressDetail(
  progress: CloudSyncProgress,
  t: (key: MessageKey, params?: MessageParams) => string,
) {
  if (progress.action && progress.path) {
    const actionKey =
      progress.action === "upload"
        ? "sync.actionUpload"
        : progress.action === "download"
          ? "sync.actionDownload"
          : progress.action === "deleteRemote"
            ? "sync.actionDeleteRemote"
            : "sync.actionDeleteLocal";
    return t(actionKey, { path: progress.path });
  }
  if (progress.phase === "listing" && progress.path) return t("sync.phaseListingPath", { path: progress.path });
  if (progress.phase === "planning" && progress.path) return t("sync.phasePlanningPath", { path: progress.path });
  if (progress.phase === "scanning") return t("sync.phaseScanning");
  if (progress.phase === "listing") return t("sync.phaseListing");
  if (progress.phase === "planning") return t("sync.phasePlanning");
  if (progress.phase === "finishing") return t("sync.phaseFinishing");
  return t("sync.phaseWorking");
}

function SyncProgress({ progress }: { progress: CloudSyncProgress }) {
  const { t } = useI18n();
  const ratio = cloudSyncProgressRatio(progress);
  const determinate = ratio !== null;
  const percent = determinate ? Math.round(ratio * 100) : undefined;
  return (
    <div {...stylex.props(styles.progress)}>
      <div
        aria-label={t("sync.progressAria")}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={percent}
        role="progressbar"
        {...stylex.props(styles.progressTrack)}
      >
        <div
          data-indeterminate={String(!determinate)}
          {...stylex.props(
            styles.progressBar,
            determinate ? styles.progressWidth(percent ?? 0) : styles.progressIndeterminate,
          )}
        />
      </div>
      <div {...stylex.props(styles.progressMeta)}>
        <p title={progress.path ?? undefined} {...stylex.props(styles.progressFile)}>
          {progressDetail(progress, t)}
        </p>
        {progress.total > 0 ? (
          <span {...stylex.props(styles.progressCount)}>
            {t("sync.progressCount", { current: progress.current, total: progress.total })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function sourceHost(url: string) {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function providerSourceLabel(profile: CloudSyncProfile) {
  if (profile.provider === "s3") {
    const endpoint = profile.s3.endpoint.trim();
    return endpoint ? sourceHost(endpoint) : profile.s3.bucket;
  }
  return profile.webdav.url ? sourceHost(profile.webdav.url) : "";
}

export function CloudSyncPanel() {
  const profile = useAppStore((state) => state.cloudSyncProfile);
  const progress = useAppStore((state) => state.cloudSyncProgress);
  const saveCloudSyncProfile = useAppStore((state) => state.saveCloudSyncProfile);
  const testCloudSync = useAppStore((state) => state.testCloudSync);
  const runCloudSync = useAppStore((state) => state.runCloudSync);
  const { t, locale } = useI18n();
  const [section, setSection] = useState<SyncSection>("status");
  const [form, setForm] = useState<CloudSyncProfile>(() => mergeCloudSyncProfile(profile));
  const [busy, setBusy] = useState<"save" | "test" | "sync" | null>(null);
  const [probeMessage, setProbeMessage] = useState("");
  const [probeOk, setProbeOk] = useState<boolean | null>(null);
  const desktop = isTauriRuntime();

  useEffect(() => {
    setForm(mergeCloudSyncProfile(profile));
  }, [profile]);

  const input = useMemo(() => toCloudSyncProfileInput(form), [form]);
  const savedInput = useMemo(() => toCloudSyncProfileInput(profile), [profile]);
  const canConnect = hasCloudSyncCredentials(input);
  const configured = hasCloudSyncCredentials(savedInput);
  const providerLabel = profile.provider === "s3" ? t("sync.providerS3") : t("sync.providerWebdav");
  const providerSource = providerSourceLabel(profile);
  const lastSyncLabel = profile.lastSyncMs
    ? formatRelativeTime(profile.lastSyncMs, locale)
    : t("sync.lastSyncNever");
  const deleted =
    (profile.lastReport?.deletedRemote ?? 0) + (profile.lastReport?.deletedLocal ?? 0);
  const syncing = busy === "sync" || progress !== null;
  const statusLabel = syncing
    ? t("sync.statusSyncing")
    : profile.lastStatus === "ok"
      ? t("sync.statusOk")
      : profile.lastStatus === "error"
        ? t("sync.statusError")
        : t("sync.statusIdle");

  const update = (patch: Partial<CloudSyncProfile>) => {
    setForm((current) => mergeCloudSyncProfile({ ...current, ...patch }));
  };

  const onSave = async () => {
    setBusy("save");
    try {
      await saveCloudSyncProfile(input);
    } catch {
      // Store already records the error.
    } finally {
      setBusy(null);
    }
  };

  const onTest = async () => {
    if (!canConnect) {
      setProbeOk(false);
      setProbeMessage(t("sync.needsConfiguration"));
      return;
    }
    setBusy("test");
    setProbeMessage("");
    try {
      const probe = await testCloudSync(input);
      setProbeOk(probe.ok);
      setProbeMessage(probe.ok ? t("sync.testOk") : probe.message);
    } catch (error) {
      setProbeOk(false);
      setProbeMessage(t("errors.testCloudSync", { message: mapGatewayError(error).message }));
    } finally {
      setBusy(null);
    }
  };

  const onSync = async () => {
    if (!savedInput.enabled) {
      setSection("setup");
      setProbeOk(false);
      setProbeMessage(t("sync.needsEnable"));
      return;
    }
    if (!configured) {
      setSection("setup");
      setProbeOk(false);
      setProbeMessage(t("sync.needsConfiguration"));
      return;
    }
    setBusy("sync");
    try {
      await runCloudSync();
    } catch {
      // Store already records the error.
    } finally {
      setBusy(null);
    }
  };

  return (
    <div {...stylex.props(styles.panel, commonStyles.fadeIn)}>
      <header
        data-tauri-drag-region={desktop ? "" : undefined}
        onMouseDown={handleWindowDragMouseDown}
        {...stylex.props(styles.header)}
      >
        <SegmentedControl
          display="icon-text"
          label={t("sync.tabStatus")}
          onChange={setSection}
          options={[
            { value: "status", label: t("sync.tabStatus"), icon: <Cloud size={14} /> },
            { value: "setup", label: t("sync.tabSetup"), icon: <Settings2 size={14} /> },
          ]}
          value={section}
        />
        {section === "status" ? (
          <IconButton
            disabled={busy !== null || syncing || !desktop}
            label={syncing ? t("sync.syncing") : t("sync.syncNow")}
            onClick={() => void onSync()}
          >
            {syncing ? (
              <Loader2 {...stylex.props(styles.icon, styles.spinning)} />
            ) : (
              <RefreshCw {...stylex.props(styles.icon)} />
            )}
          </IconButton>
        ) : (
          <span aria-hidden {...stylex.props(styles.iconSpacer)} />
        )}
      </header>

      {section === "status" ? (
        <div {...stylex.props(styles.form)}>
          {!desktop && <p {...stylex.props(styles.banner)}>{t("sync.browserOnly")}</p>}
          {!configured ? (
            <div {...stylex.props(styles.empty)}>
              <p {...stylex.props(styles.emptyTitle)}>{t("sync.emptyTitle")}</p>
              <p {...stylex.props(styles.hint)}>{t("sync.emptyBody")}</p>
              <Button onClick={() => setSection("setup")} size="sm" variant="primary">
                {t("sync.openSetup")}
              </Button>
            </div>
          ) : (
            <>
              <div
                data-status={syncing ? "syncing" : profile.lastStatus}
                {...stylex.props(
                  styles.summary,
                  !syncing && profile.lastStatus === "error" && styles.summaryError,
                  syncing && styles.summarySyncing,
                )}
              >
                <div {...stylex.props(styles.row)}>
                  <strong {...stylex.props(styles.summaryTitle)}>{statusLabel}</strong>
                  <span
                    data-on={String(profile.enabled)}
                    {...stylex.props(styles.enabled, profile.enabled && styles.enabledOn)}
                  >
                    {profile.enabled ? t("sync.enabledOn") : t("sync.enabledOff")}
                  </span>
                </div>
                <span>
                  {t("sync.lastSync")} · {lastSyncLabel}
                  {profile.lastReport?.durationMs
                    ? ` · ${t("sync.took", { duration: formatSyncDuration(profile.lastReport.durationMs) })}`
                    : ""}
                </span>
                {profile.lastError && <span>{profile.lastError}</span>}
                <p {...stylex.props(styles.summaryDescription)}>
                  {[
                    providerLabel,
                    providerSource,
                    profile.remotePrefix,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {progress ? <SyncProgress progress={progress} /> : null}
              </div>

              {profile.lastReport && !syncing && (
                <div {...stylex.props(styles.stats)}>
                  <div {...stylex.props(styles.stat)}>
                    <strong {...stylex.props(styles.statValue)}>{profile.lastReport.uploaded}</strong>
                    <span {...stylex.props(styles.statLabel)}>{t("sync.statUploaded")}</span>
                  </div>
                  <div {...stylex.props(styles.stat)}>
                    <strong {...stylex.props(styles.statValue)}>{profile.lastReport.downloaded}</strong>
                    <span {...stylex.props(styles.statLabel)}>{t("sync.statDownloaded")}</span>
                  </div>
                  <div {...stylex.props(styles.stat)}>
                    <strong {...stylex.props(styles.statValue)}>{deleted}</strong>
                    <span {...stylex.props(styles.statLabel)}>{t("sync.statDeleted")}</span>
                  </div>
                  <div {...stylex.props(styles.stat)}>
                    <strong {...stylex.props(styles.statValue)}>{profile.lastReport.skipped}</strong>
                    <span {...stylex.props(styles.statLabel)}>{t("sync.statSkipped")}</span>
                  </div>
                </div>
              )}
              {profile.lastReport && !syncing && profile.lastReport.conflicts > 0 && (
                <p {...stylex.props(styles.hint)}>{t("sync.conflicts", { count: profile.lastReport.conflicts })}</p>
              )}
              {profile.lastReport && !syncing && profile.lastReport.errors.length > 0 && (
                <p {...stylex.props(styles.hint)}>{t("sync.fileErrors", { count: profile.lastReport.errors.length })}</p>
              )}
              <Button
                disabled={busy !== null || syncing || !desktop}
                onClick={() => void onSync()}
                size="sm"
                variant="primary"
              >
                {syncing ? t("sync.syncing") : t("sync.syncNow")}
              </Button>
              <p {...stylex.props(styles.hint)}>{t("sync.autoHint")}</p>
            </>
          )}
        </div>
      ) : (
        <div {...stylex.props(styles.form)}>
          <p {...stylex.props(styles.hint)}>{t("sync.description")}</p>
          {!desktop && <p {...stylex.props(styles.banner)}>{t("sync.browserOnly")}</p>}

          <Field hint={t("sync.providerHint")} label={t("sync.provider")}>
            <Select<CloudProviderId>
              label={t("sync.provider")}
              onChange={(provider) => update({ provider })}
              options={[
                { value: "webdav", label: t("sync.providerWebdav") },
                { value: "s3", label: t("sync.providerS3") },
              ]}
              value={form.provider}
            />
          </Field>

          <div {...stylex.props(styles.row)}>
            <div>
              <div {...stylex.props(styles.rowLabel)}>{t("sync.enabled")}</div>
              <p {...stylex.props(styles.rowDescription)}>{t("sync.enabledHint")}</p>
            </div>
            <Toggle
              checked={form.enabled}
              label={t("sync.enabled")}
              onChange={(enabled) => update({ enabled })}
            />
          </div>

          {form.provider === "webdav" && (
            <>
              <Field hint={t("sync.webdavUrlHint")} label={t("sync.webdavUrl")}>
                <Input
                  autoComplete="off"
                  onChange={(event) =>
                    update({ webdav: { ...form.webdav, url: event.target.value } })
                  }
                  placeholder={t("sync.webdavUrlPlaceholder")}
                  spellCheck={false}
                  type="url"
                  value={form.webdav.url}
                />
              </Field>
              <Field label={t("sync.username")}>
                <Input
                  autoComplete="username"
                  onChange={(event) =>
                    update({ webdav: { ...form.webdav, username: event.target.value } })
                  }
                  value={form.webdav.username}
                />
              </Field>
              <Field label={t("sync.password")}>
                <Input
                  autoComplete="current-password"
                  onChange={(event) =>
                    update({ webdav: { ...form.webdav, password: event.target.value } })
                  }
                  type="password"
                  value={form.webdav.password}
                />
              </Field>
              <div {...stylex.props(styles.row)}>
                <div>
                  <div {...stylex.props(styles.rowLabel)}>{t("sync.insecureTls")}</div>
                  <p {...stylex.props(styles.rowDescription)}>{t("sync.insecureTlsHint")}</p>
                </div>
                <Toggle
                  checked={form.webdav.insecureTls}
                  label={t("sync.insecureTls")}
                  onChange={(insecureTls) =>
                    update({ webdav: { ...form.webdav, insecureTls } })
                  }
                />
              </div>
            </>
          )}

          {form.provider === "s3" && (
            <>
              <Field hint={t("sync.s3EndpointHint")} label={t("sync.s3Endpoint")}>
                <Input
                  autoComplete="url"
                  onChange={(event) => update({ s3: { ...form.s3, endpoint: event.target.value } })}
                  placeholder={t("sync.s3EndpointPlaceholder")}
                  spellCheck={false}
                  type="url"
                  value={form.s3.endpoint}
                />
              </Field>
              <Field hint={t("sync.s3RegionHint")} label={t("sync.s3Region")}>
                <Input
                  autoComplete="off"
                  onChange={(event) => update({ s3: { ...form.s3, region: event.target.value } })}
                  placeholder={t("sync.s3RegionPlaceholder")}
                  spellCheck={false}
                  value={form.s3.region}
                />
              </Field>
              <Field label={t("sync.s3Bucket")}>
                <Input
                  autoComplete="off"
                  onChange={(event) => update({ s3: { ...form.s3, bucket: event.target.value } })}
                  spellCheck={false}
                  value={form.s3.bucket}
                />
              </Field>
              <Field label={t("sync.s3AccessKeyId")}>
                <Input
                  autoComplete="username"
                  onChange={(event) => update({ s3: { ...form.s3, accessKeyId: event.target.value } })}
                  spellCheck={false}
                  value={form.s3.accessKeyId}
                />
              </Field>
              <Field label={t("sync.s3SecretAccessKey")}>
                <Input
                  autoComplete="current-password"
                  onChange={(event) => update({ s3: { ...form.s3, secretAccessKey: event.target.value } })}
                  type="password"
                  value={form.s3.secretAccessKey}
                />
              </Field>
              <Field hint={t("sync.s3SessionTokenHint")} label={t("sync.s3SessionToken")}>
                <Input
                  autoComplete="off"
                  onChange={(event) => update({ s3: { ...form.s3, sessionToken: event.target.value } })}
                  type="password"
                  value={form.s3.sessionToken}
                />
              </Field>
              <div {...stylex.props(styles.row)}>
                <div>
                  <div {...stylex.props(styles.rowLabel)}>{t("sync.s3PathStyle")}</div>
                  <p {...stylex.props(styles.rowDescription)}>{t("sync.s3PathStyleHint")}</p>
                </div>
                <Toggle
                  checked={form.s3.forcePathStyle}
                  label={t("sync.s3PathStyle")}
                  onChange={(forcePathStyle) => update({ s3: { ...form.s3, forcePathStyle } })}
                />
              </div>
              <div {...stylex.props(styles.row)}>
                <div>
                  <div {...stylex.props(styles.rowLabel)}>{t("sync.insecureTls")}</div>
                  <p {...stylex.props(styles.rowDescription)}>{t("sync.insecureTlsHint")}</p>
                </div>
                <Toggle
                  checked={form.s3.insecureTls}
                  label={t("sync.insecureTls")}
                  onChange={(insecureTls) => update({ s3: { ...form.s3, insecureTls } })}
                />
              </div>
            </>
          )}

          <Field hint={t("sync.remotePrefixHint")} label={t("sync.remotePrefix")}>
            <Input
              onChange={(event) => update({ remotePrefix: event.target.value })}
              placeholder={t("sync.remotePrefixPlaceholder")}
              spellCheck={false}
              value={form.remotePrefix}
            />
          </Field>

          {probeMessage && (
            <p
              data-ok={probeOk === null ? undefined : String(probeOk)}
              {...stylex.props(
                styles.hint,
                probeOk === true && styles.probeOk,
                probeOk === false && styles.probeError,
              )}
            >
              {probeMessage}
            </p>
          )}
          <div {...stylex.props(styles.actions)}>
            <Button disabled={busy !== null || !desktop} onClick={() => void onTest()} size="sm">
              {busy === "test" ? t("sync.testing") : t("sync.test")}
            </Button>
            <Button disabled={busy !== null} onClick={() => void onSave()} size="sm" variant="primary">
              {t("common.save")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const indeterminate = stylex.keyframes({
  from: { transform: "translateX(-130%)" },
  to: { transform: "translateX(280%)" },
});

const spin = stylex.keyframes({
  to: { transform: "rotate(360deg)" },
});

const styles = stylex.create({
  panel: {
    display: "flex",
    minHeight: 0,
    flex: 1,
    flexDirection: "column",
  },
  header: {
    display: "flex",
    height: 56,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingInline: 16,
  },
  icon: { width: 16, height: 16 },
  iconSpacer: { width: 32, height: 32 },
  spinning: {
    animationName: spin,
    animationDuration: "1s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  form: {
    display: "grid",
    minHeight: 0,
    flex: 1,
    alignContent: "start",
    gap: 8,
    overflow: "auto",
    paddingTop: 10,
    paddingRight: 12,
    paddingBottom: 16,
    paddingLeft: 12,
  },
  field: {
    display: "grid",
    gap: 7,
    color: colors.muted,
    fontSize: 11,
    fontWeight: 550,
    letterSpacing: 0,
  },
  hint: {
    margin: 0,
    color: colors.muted,
    fontSize: 11,
    lineHeight: 1.55,
  },
  banner: {
    margin: 0,
    paddingBlock: 8,
    paddingInline: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: `color-mix(in srgb, ${colors.border} 80%, transparent)`,
    borderRadius: 10,
    color: colors.muted,
    backgroundColor: `color-mix(in srgb, ${colors.panel} 88%, ${colors.elevated})`,
    fontSize: 11,
    lineHeight: 1.55,
  },
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 10,
  },
  rowLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 620,
    letterSpacing: 0,
  },
  rowDescription: {
    marginTop: 4,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    color: colors.muted,
    fontSize: 10,
    lineHeight: 1.5,
  },
  summary: {
    display: "grid",
    alignContent: "start",
    gap: 2,
    paddingBlock: 8,
    paddingInline: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: `color-mix(in srgb, ${colors.border} 72%, transparent)`,
    borderRadius: 10,
    backgroundColor: `color-mix(in srgb, ${colors.panel} 72%, transparent)`,
    color: colors.muted,
    fontSize: 11,
    lineHeight: 1.55,
  },
  summaryError: {
    borderColor: `color-mix(in srgb, ${colors.danger} 28%, ${colors.border})`,
  },
  summarySyncing: {
    borderColor: `color-mix(in srgb, ${accents.primary} 24%, ${colors.border})`,
  },
  summaryTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: 650,
  },
  summaryDescription: {
    marginTop: 6,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    color: colors.muted,
    fontSize: 10,
    lineHeight: 1.5,
  },
  enabled: {
    flex: "none",
    color: colors.muted,
    fontSize: 10,
    fontWeight: 620,
  },
  enabledOn: { color: accents.primary },
  empty: {
    display: "grid",
    justifyItems: "start",
    gap: 8,
    paddingTop: 8,
    paddingRight: 2,
    paddingBottom: 4,
    paddingLeft: 2,
  },
  emptyTitle: {
    margin: 0,
    color: colors.text,
    fontSize: 13,
    fontWeight: 650,
    letterSpacing: 0,
  },
  stats: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 8,
  },
  stat: {
    display: "grid",
    gap: 1,
    paddingBlock: 7,
    paddingInline: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: `color-mix(in srgb, ${colors.border} 68%, transparent)`,
    borderRadius: 10,
    backgroundColor: `color-mix(in srgb, ${colors.elevated} 62%, transparent)`,
  },
  statValue: {
    color: colors.text,
    fontSize: 16,
    fontWeight: 680,
    letterSpacing: 0,
    lineHeight: 1.2,
  },
  statLabel: { color: colors.muted, fontSize: 10 },
  progress: { display: "grid", gap: 6, marginTop: 8 },
  progressTrack: {
    height: 4,
    overflow: "hidden",
    borderRadius: 99,
    backgroundColor: `color-mix(in srgb, ${accents.primary} 16%, ${colors.border})`,
  },
  progressBar: {
    height: "100%",
    borderRadius: "inherit",
    backgroundColor: accents.primary,
    transitionProperty: "width",
    transitionDuration: motion.standard,
    transitionTimingFunction: motion.ease,
  },
  progressWidth: (percent: number) => ({ width: `${percent}%` }),
  progressIndeterminate: {
    width: "38%",
    animationName: {
      default: indeterminate,
      [media.reducedMotion]: "none",
    },
    animationDuration: "1.15s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
  progressMeta: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "start",
    gap: 8,
  },
  progressFile: {
    overflow: "hidden",
    margin: 0,
    color: colors.text,
    fontSize: 11,
    lineHeight: 1.45,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  progressCount: {
    color: colors.muted,
    fontSize: 10,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  probeOk: { color: accents.primary },
  probeError: { color: colors.danger },
  actions: { display: "grid", gap: 8 },
});
