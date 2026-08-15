import { describe, expect, it } from "vitest";
import { clampUiScale, DEFAULT_SETTINGS, mergeSettings, type AppSettings } from "./settings";

describe("settings merge", () => {
  it("defaults and clamps interface scale", () => {
    expect(mergeSettings(null).appearance.accent).toBe("ink");
    expect(mergeSettings(null).appearance.uiScale).toBe(1);
    expect(mergeSettings({}).appearance.uiScale).toBe(1);
    expect(
      mergeSettings({
        appearance: { ...DEFAULT_SETTINGS.appearance, uiScale: 1.25 },
      }).appearance.uiScale,
    ).toBe(1.25);
    expect(clampUiScale(0.5)).toBe(0.8);
    expect(clampUiScale(3)).toBe(2);
    expect(clampUiScale("nope")).toBe(1);
  });

  it("defaults and sanitizes locale preference", () => {
    expect(mergeSettings(null).appearance.locale).toBe("system");
    expect(mergeSettings({}).appearance.locale).toBe("system");
    expect(
      mergeSettings({
        appearance: { ...DEFAULT_SETTINGS.appearance, locale: "en" },
      }).appearance.locale,
    ).toBe("en");
    expect(
      mergeSettings({
        appearance: { ...DEFAULT_SETTINGS.appearance, locale: "zh" },
      }).appearance.locale,
    ).toBe("zh");
    expect(
      mergeSettings({
        appearance: {
          ...DEFAULT_SETTINGS.appearance,
          locale: "fr" as AppSettings["appearance"]["locale"],
        },
      }).appearance.locale,
    ).toBe("system");
  });
});
