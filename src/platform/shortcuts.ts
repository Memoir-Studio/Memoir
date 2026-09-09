export type GlobalShortcutAction =
  | "save"
  | "zoomIn"
  | "zoomOut"
  | "resetZoom"
  | "newNote"
  | "openSettings"
  | "toggleSidebar";

function hasPrimaryModifier(event: KeyboardEvent) {
  return (event.metaKey || event.ctrlKey) && !event.altKey;
}

export function globalShortcutAction(event: KeyboardEvent): GlobalShortcutAction | null {
  if (!hasPrimaryModifier(event)) return null;

  switch (event.code) {
    case "KeyS":
      return "save";
    case "Equal":
    case "NumpadAdd":
      return "zoomIn";
    case "Minus":
    case "NumpadSubtract":
      return "zoomOut";
    case "Digit0":
    case "Numpad0":
      return "resetZoom";
    case "KeyN":
      return "newNote";
    case "Comma":
      return "openSettings";
    case "KeyB":
      return "toggleSidebar";
    default:
      return null;
  }
}
