import { isTauriRuntime } from "./runtime";

export type NativeFileDropEvent =
  | { type: "hover"; x: number; y: number; paths: string[] }
  | { type: "drop"; x: number; y: number; paths: string[] }
  | { type: "leave" };

export function fileDropTargetFromPoint(
  x: number,
  y: number,
  root: Document | null = typeof document === "undefined" ? null : document,
): "editor" | null {
  if (!root || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const node = root.elementFromPoint(x, y);
  if (!node) return null;
  return node.closest(".editor-pane") ? "editor" : null;
}

export function toCssPoint(
  position: { x: number; y: number },
  scaleFactor = 1,
  zoom = 1,
) {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const uiZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return {
    x: position.x / scale / uiZoom,
    y: position.y / scale / uiZoom,
  };
}

export async function watchNativeFileDrop(
  onEvent: (event: NativeFileDropEvent) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const current = await getCurrentWindow();
  let scaleFactor = 1;
  try {
    scaleFactor = await current.scaleFactor();
  } catch {
    scaleFactor = 1;
  }
  let lastPaths: string[] = [];
  const unlisten = await current.onDragDropEvent((event) => {
    const zoom = Number(document.documentElement.style.zoom) || 1;
    const payload = event.payload;
    if (payload.type === "enter" || payload.type === "over") {
      if (payload.type === "enter") lastPaths = payload.paths;
      const point = toCssPoint(payload.position, scaleFactor, zoom);
      onEvent({ type: "hover", x: point.x, y: point.y, paths: lastPaths });
      return;
    }
    if (payload.type === "drop") {
      const point = toCssPoint(payload.position, scaleFactor, zoom);
      onEvent({ type: "drop", x: point.x, y: point.y, paths: payload.paths });
      lastPaths = [];
      return;
    }
    lastPaths = [];
    onEvent({ type: "leave" });
  });
  return unlisten;
}
