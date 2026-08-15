import { clampUiScale, DEFAULT_SETTINGS } from "../domain/settings";
import { isTauriRuntime } from "./runtime";

const nativeDevicePixelRatio =
  typeof window === "undefined" || !Number.isFinite(window.devicePixelRatio)
    ? 1
    : window.devicePixelRatio;

export function getNativeDevicePixelRatio() {
  return nativeDevicePixelRatio;
}

export function shouldCompensateSystemScale(
  systemScale: number,
  devicePixelRatio: number,
) {
  return systemScale > 1.08 && devicePixelRatio < 1.08;
}

export function computeEffectiveZoom({
  userScale,
  systemScale,
  devicePixelRatio,
}: {
  userScale: number;
  systemScale: number;
  devicePixelRatio: number;
}) {
  const safeUserScale = clampUiScale(userScale);
  const safeSystemScale =
    Number.isFinite(systemScale) && systemScale > 0 ? systemScale : 1;
  const safeDevicePixelRatio =
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
      ? devicePixelRatio
      : 1;
  const zoom = shouldCompensateSystemScale(safeSystemScale, safeDevicePixelRatio)
    ? safeUserScale * safeSystemScale
    : safeUserScale;
  return Math.min(4, Math.max(0.5, zoom));
}

function applyCssZoom(zoom: number) {
  const root = document.documentElement;
  if (Math.abs(zoom - 1) < 0.001) {
    root.style.removeProperty("zoom");
    root.style.removeProperty("--memoir-ui-zoom");
    return;
  }
  root.style.zoom = String(zoom);
  root.style.setProperty("--memoir-ui-zoom", String(zoom));
}

async function readSystemScale() {
  if (!isTauriRuntime()) return nativeDevicePixelRatio || 1;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return await getCurrentWindow().scaleFactor();
  } catch {
    return nativeDevicePixelRatio || 1;
  }
}

export async function applyInterfaceZoom(
  userScale: number,
  systemScale?: number,
) {
  const resolvedSystemScale = systemScale ?? (await readSystemScale());
  const zoom = computeEffectiveZoom({
    userScale,
    systemScale: resolvedSystemScale,
    devicePixelRatio: nativeDevicePixelRatio,
  });

  if (isTauriRuntime()) {
    try {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      await getCurrentWebview().setZoom(zoom);
      applyCssZoom(1);
      return zoom;
    } catch {
      // Linux without the zoom permission, or browser-hosted tests.
    }
  }

  applyCssZoom(zoom);
  return zoom;
}

export async function bootstrapInterfaceZoom() {
  await applyInterfaceZoom(DEFAULT_SETTINGS.appearance.uiScale);
}

export async function watchSystemScale(
  onScaleChange: (systemScale: number) => void,
) {
  if (!isTauriRuntime()) return () => undefined;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow().onScaleChanged(({ payload }) => {
      onScaleChange(payload.scaleFactor);
    });
  } catch {
    return () => undefined;
  }
}