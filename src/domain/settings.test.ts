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

  it("defaults and sanitizes close behavior", () => {
    expect(mergeSettings(null).general.closeBehavior).toBe("tray");
    expect(mergeSettings({}).general.closeBehavior).toBe("tray");
    expect(
      mergeSettings({
        general: { closeBehavior: "quit" },
      }).general.closeBehavior,
    ).toBe("quit");
    expect(
      mergeSettings({
        general: {
          closeBehavior: "hide" as AppSettings["general"]["closeBehavior"],
        },
      }).general.closeBehavior,
    ).toBe("tray");
  });

  it("defaults and sanitizes note sort", () => {
    expect(mergeSettings(null).general.noteSort).toBe("name");
    expect(mergeSettings(null).general.noteSortDirection).toBe("asc");
    expect(
      mergeSettings({
        general: { ...DEFAULT_SETTINGS.general, noteSort: "modified", noteSortDirection: "desc" },
      }).general,
    ).toMatchObject({ noteSort: "modified", noteSortDirection: "desc" });
    expect(
      mergeSettings({
        general: {
          ...DEFAULT_SETTINGS.general,
          noteSort: "size" as AppSettings["general"]["noteSort"],
          noteSortDirection: "sideways" as AppSettings["general"]["noteSortDirection"],
        },
      }).general,
    ).toMatchObject({ noteSort: "name", noteSortDirection: "asc" });
  });

  it("adds AI defaults when loading older preferences", () => {
    const settings = mergeSettings({
      appearance: { locale: "en" },
      ai: { provider: "ollama", chatModel: "qwen3:8b" },
    });

    expect(settings.ai).toMatchObject({
      enabled: false,
      provider: "ollama",
      baseUrl: "https://api.openai.com/v1",
      embeddingModel: "text-embedding-3-small",
      chatModel: "qwen3:8b",
    });
  });

  it("falls back to the default AI provider for unknown values", () => {
    expect(
      mergeSettings({
        ai: { provider: "unsupported" as AppSettings["ai"]["provider"] },
      }).ai.provider,
    ).toBe("openai");
  });
});
