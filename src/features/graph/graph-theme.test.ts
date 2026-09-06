import { describe, expect, it } from "vitest";
import { themeFromAppearance } from "./graph-theme";

describe("graph theme", () => {
  it("derives explicit and system themes without reading computed CSS", () => {
    const light = themeFromAppearance({ theme: "light", accent: "blue" }, true);
    const dark = themeFromAppearance({ theme: "system", accent: "ink" }, true);

    expect(light).toMatchObject({ dark: false, canvas: "#fbfaf6", accent: "#3f7edb" });
    expect(dark).toMatchObject({ dark: true, canvas: "#171714", accent: "#efede7" });
  });
});
