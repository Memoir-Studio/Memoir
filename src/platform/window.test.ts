import { describe, expect, it } from "vitest";
import { applyWindowFrameState } from "./window";

describe("applyWindowFrameState", () => {
  it("toggles the maximized attribute used by window chrome CSS", () => {
    const root = document.createElement("html");
    applyWindowFrameState(true, root);
    expect(root.dataset.maximized).toBe("true");
    applyWindowFrameState(false, root);
    expect(root.dataset.maximized).toBeUndefined();
  });
});
