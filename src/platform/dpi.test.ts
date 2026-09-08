import { describe, expect, it } from "vitest";
import { computeEffectiveZoom, shouldCompensateSystemScale } from "./dpi";

describe("interface zoom", () => {
  it("leaves DPI-aware webviews at the user scale", () => {
    expect(
      computeEffectiveZoom({
        userScale: 1.25,
        systemScale: 1.5,
        devicePixelRatio: 1.5,
      }),
    ).toBe(1.25);
    expect(shouldCompensateSystemScale(1.5, 1.5)).toBe(false);
  });

  it("compensates when the webview ignores a HiDPI scale factor", () => {
    expect(
      computeEffectiveZoom({
        userScale: 1,
        systemScale: 1.5,
        devicePixelRatio: 1,
      }),
    ).toBe(1.5);
    expect(
      computeEffectiveZoom({
        userScale: 1.25,
        systemScale: 2,
        devicePixelRatio: 1,
      }),
    ).toBe(2.5);
    expect(shouldCompensateSystemScale(1.25, 1)).toBe(true);
  });

  it("does not compensate a 100% display", () => {
    expect(
      computeEffectiveZoom({
        userScale: 1,
        systemScale: 1,
        devicePixelRatio: 1,
      }),
    ).toBe(1);
    expect(shouldCompensateSystemScale(1, 1)).toBe(false);
  });
});
