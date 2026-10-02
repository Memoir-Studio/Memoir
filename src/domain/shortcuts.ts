export const SHORTCUT_ACTIONS = [
  "save", "newNote", "openSettings", "toggleSidebar", "toggleFocus", "zoomIn", "zoomOut", "resetZoom",
] as const;

export type GlobalShortcutAction = typeof SHORTCUT_ACTIONS[number];
export type ShortcutSettings = Record<GlobalShortcutAction, string | null>;

export const DEFAULT_SHORTCUTS: ShortcutSettings = {
  save: "Mod+KeyS",
  newNote: "Mod+KeyN",
  openSettings: "Mod+Comma",
  toggleSidebar: "Mod+KeyB",
  toggleFocus: "Mod+Shift+KeyF",
  zoomIn: "Mod+Equal",
  zoomOut: "Mod+Minus",
  resetZoom: "Mod+Digit0",
};

const keyLabels: Record<string, string> = {
  Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Semicolon: ";",
  Quote: "'", Backquote: "`", BracketLeft: "[", BracketRight: "]",
  Equal: "=", Minus: "-", Space: "Space", Enter: "Enter",
  Backspace: "Backspace", Delete: "Delete", Home: "Home", End: "End",
  PageUp: "PageUp", PageDown: "PageDown",
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
};

function isShortcutCode(code: string) {
  return /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2]))$/.test(code) || Object.prototype.hasOwnProperty.call(keyLabels, code);
}

export function isShortcutBinding(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^Mod\+(?:Alt\+)?(?:Shift\+)?([^+]+)$/.exec(value);
  return Boolean(match && isShortcutCode(match[1]));
}

export function mergeShortcuts(shortcuts?: Partial<ShortcutSettings> | null): ShortcutSettings {
  const result = { ...DEFAULT_SHORTCUTS };
  for (const action of SHORTCUT_ACTIONS) {
    const binding = shortcuts?.[action];
    if (binding === null || isShortcutBinding(binding)) result[action] = binding;
  }
  return result;
}

export function formatShortcut(binding: string, mac = false): string {
  return binding.split("+").map((part) => {
    if (part === "Mod") return mac ? "⌘" : "Ctrl";
    if (part === "Alt") return mac ? "⌥" : "Alt";
    if (part === "Shift") return mac ? "⇧" : "Shift";
    return keyLabels[part] ?? part.replace(/^(Key|Digit)/, "");
  }).join(" + ");
}
