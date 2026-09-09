import { describe, expect, it } from "vitest";
import { globalShortcutAction } from "./shortcuts";

function key(code: string, options: Partial<KeyboardEventInit> = {}) {
  return new KeyboardEvent("keydown", {
    code,
    ctrlKey: true,
    ...options,
  });
}

describe("global shortcuts", () => {
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
