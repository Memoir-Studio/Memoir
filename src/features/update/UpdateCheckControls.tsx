import { useState } from "react";
import { Button } from "../../components/ui";
import type { AppUpdateCheck } from "../../domain/app-update";
import { isAllowedReleaseUrl } from "../../domain/app-update";
import { mapGatewayError } from "../../domain/errors";
import { getGateways } from "../../gateways";
import { useI18n } from "../../i18n/react";

type CheckPhase = "idle" | "checking" | "upToDate" | "available" | "skipped" | "error";

function formatUpdateCheckError(error: unknown): string {
  const mapped = mapGatewayError(error);
  if (mapped.details && !mapped.message.includes(mapped.details)) {
    return `${mapped.message} (${mapped.details})`;
  }
  return mapped.message;
}

export function UpdateCheckControls() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<CheckPhase>("idle");
  const [result, setResult] = useState<AppUpdateCheck | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  async function check() {
    setPhase("checking");
    setErrorMessage("");
    try {
      const next = await getGateways().persistence.checkAppUpdate();
      setResult(next);
      setPhase(next.status);
    } catch (error) {
      setResult(null);
      setErrorMessage(formatUpdateCheckError(error));
      setPhase("error");
    }
  }

  async function skip() {
    const version = result?.latestVersion;
    if (!version) return;
    try {
      await getGateways().persistence.skipAppUpdate(version);
      setPhase("skipped");
    } catch (error) {
      setErrorMessage(formatUpdateCheckError(error));
      setPhase("error");
    }
  }

  async function download() {
    const url = result?.releaseUrl;
    if (!url || !isAllowedReleaseUrl(url)) return;
    await getGateways().workspace.openExternal(url);
  }

  return (
    <div className="settings-update">
      <Button disabled={phase === "checking"} onClick={() => void check()}>
        {phase === "checking" ? t("settings.checkingUpdate") : t("settings.checkUpdate")}
      </Button>
      {phase === "upToDate" && <p className="settings-update-status">{t("settings.upToDate")}</p>}
      {phase === "skipped" && (
        <p className="settings-update-status">
          {t("settings.updateSkipped", { version: result?.latestVersion ?? "" })}
        </p>
      )}
      {phase === "available" && result?.latestVersion && (
        <>
          <p className="settings-update-status">
            {t("settings.updateAvailable", { version: result.latestVersion })}
          </p>
          <div className="settings-update-actions">
            <Button onClick={() => void skip()}>{t("update.skip")}</Button>
            <Button onClick={() => void download()} variant="primary">
              {t("update.download")}
            </Button>
          </div>
        </>
      )}
      {phase === "error" && (
        <p className="settings-update-status">
          {t("settings.updateFailed", { message: errorMessage })}
        </p>
      )}
    </div>
  );
}
