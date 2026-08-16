import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Input, Select, Toggle } from "../../components/ui";
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

export function CloudSyncPanel() {
  const profile = useAppStore((state) => state.cloudSyncProfile);
  const saveCloudSyncProfile = useAppStore((state) => state.saveCloudSyncProfile);
  const testCloudSync = useAppStore((state) => state.testCloudSync);
  const runCloudSync = useAppStore((state) => state.runCloudSync);
  const { t, locale } = useI18n();
  const [form, setForm] = useState<CloudSyncProfile>(() => mergeCloudSyncProfile(profile));
  const [busy, setBusy] = useState<"save" | "test" | "sync" | null>(null);
  const [probeMessage, setProbeMessage] = useState("");
  const [probeOk, setProbeOk] = useState<boolean | null>(null);
  const desktop = isTauriRuntime();

  useEffect(() => {
    setForm(mergeCloudSyncProfile(profile));
  }, [profile]);

  const input = useMemo(() => toCloudSyncProfileInput(form), [form]);
  const canConnect = hasCloudSyncCredentials(input);
  const lastSyncLabel = form.lastSyncMs
    ? formatRelativeTime(form.lastSyncMs, locale)
    : t("sync.lastSyncNever");
  const deleted =
    (form.lastReport?.deletedRemote ?? 0) + (form.lastReport?.deletedLocal ?? 0);

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
    if (!input.enabled) {
      setProbeOk(false);
      setProbeMessage(t("sync.needsEnable"));
      return;
    }
    if (!canConnect) {
      setProbeOk(false);
      setProbeMessage(t("sync.needsUrl"));
      return;
    }
    setBusy("sync");
    try {
      await runCloudSync(input);
    } catch {
      // Store already records the error.
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="cloud-sync-panel memoir-fade-in flex min-h-0 flex-1 flex-col overflow-auto px-3 pb-4 pt-2.5">
      <div className="cloud-sync-form">
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

        <div className="cloud-sync-status" data-status={form.lastStatus}>
          <strong>
            {t("sync.lastSync")} ·{" "}
            {form.lastStatus === "ok"
              ? t("sync.statusOk")
              : form.lastStatus === "error"
                ? t("sync.statusError")
                : t("sync.statusIdle")}
          </strong>
          <span>{lastSyncLabel}</span>
          {form.lastError && <span>{form.lastError}</span>}
          {form.lastReport && (
            <span>
              {t("sync.report", {
                uploaded: form.lastReport.uploaded,
                downloaded: form.lastReport.downloaded,
                deleted,
                skipped: form.lastReport.skipped,
              })}
            </span>
          )}
          {form.lastReport && form.lastReport.conflicts > 0 && (
            <span>{t("sync.conflicts", { count: form.lastReport.conflicts })}</span>
          )}
          {form.lastReport && form.lastReport.errors.length > 0 && (
            <span>{t("sync.fileErrors", { count: form.lastReport.errors.length })}</span>
          )}
        </div>
        {probeMessage && (
          <p className="cloud-sync-probe" data-ok={probeOk === null ? undefined : String(probeOk)}>
            {probeMessage}
          </p>
        )}
        <p className="cloud-sync-hint">{t("sync.localHint")}</p>
        <div className="cloud-sync-actions">
          <Button disabled={busy !== null || !desktop} onClick={() => void onTest()} size="sm">
            {busy === "test" ? t("sync.testing") : t("sync.test")}
          </Button>
          <Button disabled={busy !== null} onClick={() => void onSave()} size="sm">
            {t("common.save")}
          </Button>
          <Button
            disabled={busy !== null || !desktop}
            onClick={() => void onSync()}
            size="sm"
            variant="primary"
          >
            {busy === "sync" ? t("sync.syncing") : t("sync.syncNow")}
          </Button>
        </div>
      </div>
    </div>
  );
}
