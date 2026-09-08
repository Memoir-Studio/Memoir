import { describe, expect, it } from "vitest";
import { installNativeContextMenuBlock } from "./native-context-menu";

describe("installNativeContextMenuBlock", () => {
  it("prevents the default browser context menu", () => {
    const dispose = installNativeContextMenuBlock();
    const event = new Event("contextmenu", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    dispose();
  });
});
