import { describe, expect, it } from "vitest";
import { DEFAULT_SHORTCUTS } from "../domain/shortcuts";
import { globalShortcutAction, shortcutFromEvent } from "./shortcuts";

function key(code: string, options: Partial<KeyboardEventInit> = {}) {
  return new KeyboardEvent("keydown", {
    code,
    ctrlKey: true,
    ...options,
  });
}

describe("global shortcuts", () => {
  it("supports the default and custom focus mode bindings", () => {
    expect(globalShortcutAction(key("KeyF", { shiftKey: true }))).toBe("toggleFocus");
    expect(globalShortcutAction(key("KeyF", { ctrlKey: false, metaKey: true, shiftKey: true }))).toBe("toggleFocus");
    expect(globalShortcutAction(key("KeyF"))).toBeNull();
    const shortcuts = { ...DEFAULT_SHORTCUTS, toggleFocus: "Mod+KeyI" };
    expect(globalShortcutAction(key("KeyF", { shiftKey: true }), shortcuts)).toBeNull();
    expect(globalShortcutAction(key("KeyI"), shortcuts)).toBe("toggleFocus");
    expect(globalShortcutAction(key("KeyF", { shiftKey: true }), {
      ...DEFAULT_SHORTCUTS, toggleFocus: null,
    })).toBeNull();
  });
  it("uses custom bindings and supports disabling actions", () => {
    const shortcuts = { ...DEFAULT_SHORTCUTS, save: "Mod+Alt+Shift+KeyP", newNote: null };
    expect(globalShortcutAction(key("KeyS"), shortcuts)).toBeNull();
    expect(globalShortcutAction(key("KeyN"), shortcuts)).toBeNull();
    expect(globalShortcutAction(key("KeyP", { altKey: true, shiftKey: true }), shortcuts)).toBe("save");
    expect(globalShortcutAction(key("KeyP", { shiftKey: true }), shortcuts)).toBeNull();
    expect(globalShortcutAction(key("KeyS", { shiftKey: true }))).toBeNull();
  });

  it("preserves shifted and numpad zoom shortcuts", () => {
    expect(globalShortcutAction(key("Equal", { shiftKey: true }))).toBe("zoomIn");
    expect(globalShortcutAction(key("NumpadSubtract"))).toBe("zoomOut");
    expect(globalShortcutAction(key("Numpad0"))).toBe("resetZoom");
    expect(globalShortcutAction(key("Equal", { shiftKey: true }), {
      ...DEFAULT_SHORTCUTS, zoomIn: null,
    })).toBeNull();
  });

  it("ignores composition, handled events and unsupported combinations", () => {
    expect(shortcutFromEvent(key("KeyS", { isComposing: true }))).toBeNull();
    expect(shortcutFromEvent(key("KeyS", { ctrlKey: false }))).toBeNull();
    expect(shortcutFromEvent(key("KeyS", { metaKey: true }))).toBeNull();
    expect(shortcutFromEvent(key("ControlLeft"))).toBeNull();
    const handled = key("KeyS", { cancelable: true });
    handled.preventDefault();
    expect(globalShortcutAction(handled)).toBeNull();
  });
  it("matches application shortcuts with Ctrl", () => {
    expect(globalShortcutAction(key("Equal"))).toBe("zoomIn");
    expect(globalShortcutAction(key("NumpadAdd"))).toBe("zoomIn");
    expect(globalShortcutAction(key("Minus"))).toBe("zoomOut");
    expect(globalShortcutAction(key("Digit0"))).toBe("resetZoom");
    expect(globalShortcutAction(key("KeyS"))).toBe("save");
    expect(globalShortcutAction(key("KeyN"))).toBe("newNote");
    expect(globalShortcutAction(key("Comma"))).toBe("openSettings");
    expect(globalShortcutAction(key("KeyB"))).toBe("toggleSidebar");
  });

  it("supports Cmd and ignores Alt-modified shortcuts", () => {
    expect(globalShortcutAction(key("Equal", { ctrlKey: false, metaKey: true }))).toBe("zoomIn");
    expect(globalShortcutAction(key("Equal", { altKey: true }))).toBeNull();
  });
});
