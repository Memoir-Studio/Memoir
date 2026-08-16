import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Cloud, Loader2, RefreshCw, Settings2 } from "lucide-react";
import { Button, IconButton, Input, Select, Toggle } from "../../components/ui";
import {
  hasCloudSyncCredentials,
  mergeCloudSyncProfile,
  toCloudSyncProfileInput,
  type CloudProviderId,
  type CloudSyncProfile,
} from "../../domain/cloud-sync";
import { mapGatewayError } from "../../domain/errors";
import { formatRelativeTime } from "../../i18n";
import { useI18n } from "../../i18n/react";
import { isTauriRuntime } from "../../platform/runtime";
import { useAppStore } from "../../store/app-store";
import { handleWindowDragMouseDown } from "../window/window-drag";

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
    <label className="memoir-field-label">
      <span>{label}</span>
      {children}
      {hint ? <span className="cloud-sync-row-description">{hint}</span> : null}
    </label>
  );
}

function sourceHost(url: string) {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export function CloudSyncPanel() {
  const profile = useAppStore((state) => state.cloudSyncProfile);
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
  const lastSyncLabel = profile.lastSyncMs
    ? formatRelativeTime(profile.lastSyncMs, locale)
    : t("sync.lastSyncNever");
  const deleted =
    (profile.lastReport?.deletedRemote ?? 0) + (profile.lastReport?.deletedLocal ?? 0);
  const statusLabel =
    busy === "sync"
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
      setProbeMessage(t("sync.needsUrl"));
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
      setProbeMessage(t("sync.needsUrl"));
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
    <div className="cloud-sync-panel memoir-fade-in flex min-h-0 flex-1 flex-col">
      <header
        className="flex h-14 shrink-0 items-center justify-between gap-2 px-4"
        data-tauri-drag-region={desktop ? "" : undefined}
        onMouseDown={handleWindowDragMouseDown}
      >
        <div className="view-switcher library-mode-switcher flex items-center rounded-lg p-0.5">
          <IconButton
            active={section === "status"}
            label={t("sync.tabStatus")}
            onClick={() => setSection("status")}
          >
            <Cloud className="h-3.5 w-3.5" />
            <span>{t("sync.tabStatus")}</span>
          </IconButton>
          <IconButton
            active={section === "setup"}
            label={t("sync.tabSetup")}
            onClick={() => setSection("setup")}
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span>{t("sync.tabSetup")}</span>
          </IconButton>
        </div>
        {section === "status" ? (
          <IconButton
            disabled={busy !== null || !desktop}
            label={busy === "sync" ? t("sync.syncing") : t("sync.syncNow")}
            onClick={() => void onSync()}
          >
            {busy === "sync" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </IconButton>
        ) : (
          <span aria-hidden className="h-8 w-8" />
        )}
      </header>

      {section === "status" ? (
        <div className="cloud-sync-form min-h-0 flex-1 overflow-auto px-3 pb-4 pt-2.5">
          {!desktop && <p className="cloud-sync-banner">{t("sync.browserOnly")}</p>}
          {!configured ? (
            <div className="cloud-sync-empty">
              <p className="cloud-sync-empty-title">{t("sync.emptyTitle")}</p>
              <p className="cloud-sync-hint">{t("sync.emptyBody")}</p>
              <Button onClick={() => setSection("setup")} size="sm" variant="primary">
                {t("sync.openSetup")}
              </Button>
            </div>
          ) : (
            <>
              <div
                className="cloud-sync-summary"
                data-status={busy === "sync" ? "syncing" : profile.lastStatus}
              >
                <div className="cloud-sync-row">
                  <strong>{statusLabel}</strong>
                  <span className="cloud-sync-enabled" data-on={String(profile.enabled)}>
                    {profile.enabled ? t("sync.enabledOn") : t("sync.enabledOff")}
                  </span>
                </div>
                <span>
                  {t("sync.lastSync")} · {lastSyncLabel}
                </span>
                {profile.lastError && <span>{profile.lastError}</span>}
                <p className="cloud-sync-row-description">
                  {[
                    t("sync.providerWebdav"),
                    profile.webdav.url ? sourceHost(profile.webdav.url) : "",
                    profile.remotePrefix,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>

              {profile.lastReport && (
                <div className="cloud-sync-stats">
                  <div className="cloud-sync-stat">
                    <strong>{profile.lastReport.uploaded}</strong>
                    <span>{t("sync.statUploaded")}</span>
                  </div>
                  <div className="cloud-sync-stat">
                    <strong>{profile.lastReport.downloaded}</strong>
                    <span>{t("sync.statDownloaded")}</span>
                  </div>
                  <div className="cloud-sync-stat">
                    <strong>{deleted}</strong>
                    <span>{t("sync.statDeleted")}</span>
                  </div>
                  <div className="cloud-sync-stat">
                    <strong>{profile.lastReport.skipped}</strong>
                    <span>{t("sync.statSkipped")}</span>
                  </div>
                </div>
              )}
              {profile.lastReport && profile.lastReport.conflicts > 0 && (
                <p className="cloud-sync-hint">{t("sync.conflicts", { count: profile.lastReport.conflicts })}</p>
              )}
              {profile.lastReport && profile.lastReport.errors.length > 0 && (
                <p className="cloud-sync-hint">{t("sync.fileErrors", { count: profile.lastReport.errors.length })}</p>
              )}
              <Button
                disabled={busy !== null || !desktop}
                onClick={() => void onSync()}
                size="sm"
                variant="primary"
              >
                {busy === "sync" ? t("sync.syncing") : t("sync.syncNow")}
              </Button>
              <p className="cloud-sync-hint">{t("sync.localHint")}</p>
            </>
          )}
        </div>
      ) : (
        <div className="cloud-sync-form min-h-0 flex-1 overflow-auto px-3 pb-4 pt-2.5">
          <p className="cloud-sync-hint">{t("sync.description")}</p>
          {!desktop && <p className="cloud-sync-banner">{t("sync.browserOnly")}</p>}

          <Field hint={t("sync.providerHint")} label={t("sync.provider")}>
            <Select<CloudProviderId>
              label={t("sync.provider")}
              onChange={(provider) => update({ provider })}
              options={[{ value: "webdav", label: t("sync.providerWebdav") }]}
              value={form.provider}
            />
          </Field>

          <div className="cloud-sync-row">
            <div>
              <div className="cloud-sync-row-label">{t("sync.enabled")}</div>
              <p className="cloud-sync-row-description">{t("sync.enabledHint")}</p>
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
              <Field hint={t("sync.remotePrefixHint")} label={t("sync.remotePrefix")}>
                <Input
                  onChange={(event) => update({ remotePrefix: event.target.value })}
                  placeholder={t("sync.remotePrefixPlaceholder")}
                  spellCheck={false}
                  value={form.remotePrefix}
                />
              </Field>
              <div className="cloud-sync-row">
                <div>
                  <div className="cloud-sync-row-label">{t("sync.insecureTls")}</div>
                  <p className="cloud-sync-row-description">{t("sync.insecureTlsHint")}</p>
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

          {probeMessage && (
            <p className="cloud-sync-probe" data-ok={probeOk === null ? undefined : String(probeOk)}>
              {probeMessage}
            </p>
          )}
          <div className="cloud-sync-actions">
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
