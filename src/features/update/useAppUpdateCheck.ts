import { useCallback, useEffect, useState } from "react";
import type { AppUpdateCheck } from "../../domain/app-update";
import { isAllowedReleaseUrl } from "../../domain/app-update";
import { getGateways } from "../../gateways";

let autoCheckPromise: Promise<AppUpdateCheck> | null = null;

export function resetAppUpdateCheckForTests() {
  autoCheckPromise = null;
}

export function useAppUpdateCheck() {
  const [notice, setNotice] = useState<AppUpdateCheck | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!autoCheckPromise) {
      autoCheckPromise = getGateways().persistence.checkAppUpdate();
    }
    void autoCheckPromise
      .then((result) => {
        if (!cancelled && result.status === "available") {
          setNotice(result);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    setNotice(null);
  }, []);

  const skip = useCallback(async () => {
    const version = notice?.latestVersion;
    setNotice(null);
    if (!version) return;
    try {
      await getGateways().persistence.skipAppUpdate(version);
    } catch {
      // Session already dismissed; the next launch can prompt again.
    }
  }, [notice]);

  const openRelease = useCallback(async () => {
    const url = notice?.releaseUrl;
    if (!url || !isAllowedReleaseUrl(url)) return;
    await getGateways().workspace.openExternal(url);
    setNotice(null);
  }, [notice]);

  return { notice, dismiss, skip, openRelease };
}
