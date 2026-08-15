import { detectHostOs, isTauriRuntime, type HostOs } from "./runtime";

export type WindowResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

async function currentWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export function applyWindowFrameState(
  expanded: boolean,
  root: HTMLElement = document.documentElement,
) {
  if (expanded) root.dataset.maximized = "true";
  else delete root.dataset.maximized;
}

export function applyHostWindowChrome(
  root: HTMLElement = document.documentElement,
  os: HostOs = detectHostOs(),
) {
  root.dataset.os = os;
  if (isTauriRuntime() && os === "windows") {
    root.dataset.windowFrame = "flush";
  } else {
    delete root.dataset.windowFrame;
  }
}

export async function watchWindowFrameState(onChange: (expanded: boolean) => void) {
  if (!isTauriRuntime()) return () => undefined;

  try {
    const window = await currentWindow();
    let frame = 0;

    const emit = async () => {
      const [maximized, fullscreen] = await Promise.all([
        window.isMaximized(),
        window.isFullscreen(),
      ]);
      onChange(maximized || fullscreen);
    };

    // GTK can report the pre-maximize size first; read again on the next frame.
    const emitSoon = () => {
      void emit();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        void emit();
      });
    };

    await emit();
    const stopResize = await window.onResized(emitSoon);
    const stopMoved = await window.onMoved(emitSoon);
    return () => {
      cancelAnimationFrame(frame);
      stopResize();
      stopMoved();
    };
  } catch {
    return () => undefined;
  }
}

export async function performWindowAction(
  type: "close" | "minimize" | "maximize",
) {
  const window = await currentWindow();
  if (type === "close") await window.close();
  else if (type === "minimize") await window.minimize();
  else await window.toggleMaximize();
}

export async function startWindowResize(direction: WindowResizeDirection) {
  const window = await currentWindow();
  await window.startResizeDragging(direction);
}

export async function startWindowDragging() {
  const window = await currentWindow();
  await window.startDragging();
}
