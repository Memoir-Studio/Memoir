import { afterEach, describe, expect, it } from "vitest";
import { detectHostOs } from "./runtime";
import { applyHostWindowChrome, applyWindowFrameState } from "./window";

afterEach(() => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("applyWindowFrameState", () => {
  it("toggles the maximized attribute used by window chrome CSS", () => {
    const root = document.createElement("html");
    applyWindowFrameState(true, root);
    expect(root.dataset.maximized).toBe("true");
    applyWindowFrameState(false, root);
    expect(root.dataset.maximized).toBeUndefined();
  });
});

describe("detectHostOs", () => {
  it("recognizes windows, macos, and linux platform hints", () => {
    expect(detectHostOs("Win32 Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectHostOs("MacIntel Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macos");
    expect(detectHostOs("Linux x86_64 Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });
});

describe("applyHostWindowChrome", () => {
  it("uses a flush frame on Windows desktop so the transparent halo is gone", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
    const root = document.createElement("html");
    applyHostWindowChrome(root, "windows");
    expect(root.dataset.os).toBe("windows");
    expect(root.dataset.windowFrame).toBe("flush");
  });

  it("keeps the floating inset frame on other desktop hosts", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
    const root = document.createElement("html");
    applyHostWindowChrome(root, "macos");
    expect(root.dataset.windowFrame).toBeUndefined();
  });

  it("does not flush the browser demo", () => {
    const root = document.createElement("html");
    applyHostWindowChrome(root, "windows");
    expect(root.dataset.windowFrame).toBeUndefined();
  });
});
