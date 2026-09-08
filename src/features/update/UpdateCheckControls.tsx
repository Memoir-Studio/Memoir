import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Button } from "../../components/ui";
import type { AppUpdateCheck } from "../../domain/app-update";
import { isAllowedReleaseUrl } from "../../domain/app-update";
import { mapGatewayError } from "../../domain/errors";
import { getGateways } from "../../gateways";
import { useI18n } from "../../i18n/react";
import { colors, typography } from "../../styles/tokens.stylex";

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
      await getGateways().system.openExternal(url);
  }

  return (
    <div {...stylex.props(styles.root)}>
      <Button disabled={phase === "checking"} onClick={() => void check()}>
        {phase === "checking" ? t("settings.checkingUpdate") : t("settings.checkUpdate")}
      </Button>
      {phase === "upToDate" && <p {...stylex.props(styles.status)}>{t("settings.upToDate")}</p>}
      {phase === "skipped" && (
        <p {...stylex.props(styles.status)}>
          {t("settings.updateSkipped", { version: result?.latestVersion ?? "" })}
        </p>
      )}
      {phase === "available" && result?.latestVersion && (
        <>
          <p {...stylex.props(styles.status)}>
            {t("settings.updateAvailable", { version: result.latestVersion })}
          </p>
          <div {...stylex.props(styles.actions)}>
            <Button onClick={() => void skip()}>{t("update.skip")}</Button>
            <Button onClick={() => void download()} variant="primary">
              {t("update.download")}
            </Button>
          </div>
        </>
      )}
      {phase === "error" && (
        <p {...stylex.props(styles.status)}>
          {t("settings.updateFailed", { message: errorMessage })}
        </p>
      )}
    </div>
  );
}

const styles = stylex.create({
  root: {
    display: "grid",
    gap: 10,
    justifyItems: "center",
    marginTop: 18,
  },
  status: {
    color: colors.muted,
    fontFamily: typography.uiFont,
    fontSize: 12,
    lineHeight: 1.5,
    margin: 0,
    maxWidth: "22rem",
    overflowWrap: "anywhere",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
});
