import { describe, expect, it } from "vitest";
import { formatRelativeTime, formatSyncDuration } from "./format";
import { detectSystemLocale, htmlLang, resolveLocale } from "./locale";
import { en } from "./en";
import { zh } from "./zh";
import { interpolate, messageKeys, t, tc } from "./translate";

describe("i18n", () => {
  it("keeps Chinese and English catalogs aligned", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    expect(messageKeys.length).toBe(Object.keys(zh).length);
  });

  it("interpolates parameters and falls back to the Chinese catalog", () => {
    expect(interpolate("Hello {name}", { name: "Memoir" })).toBe("Hello Memoir");
    expect(interpolate("Hello {name}")).toBe("Hello {name}");
    expect(t("zh", "status.noteCount", { count: 3 })).toBe("3 篇笔记");
    expect(t("en", "status.noteCount", { count: 3 })).toBe("3 notes");
  });

  it("selects English singular forms", () => {
    expect(tc("en", "status.noteCount", 1)).toBe("1 note");
    expect(tc("en", "status.noteCount", 2)).toBe("2 notes");
    expect(tc("zh", "status.noteCount", 1)).toBe("1 篇笔记");
  });

  it("resolves system locale from the browser language", () => {
    expect(resolveLocale("zh")).toBe("zh");
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("system", "zh-CN")).toBe("zh");
    expect(resolveLocale("system", "en-US")).toBe("en");
    expect(detectSystemLocale("zh-TW")).toBe("zh");
    expect(detectSystemLocale("fr-FR")).toBe("en");
    expect(htmlLang("zh")).toBe("zh-CN");
    expect(htmlLang("en")).toBe("en");
  });

  it("formats relative timestamps per locale", () => {
    const now = 1_700_000_000_000;
    expect(formatRelativeTime(0, "en", now)).toBe("Unknown");
    expect(formatRelativeTime(now - 10_000, "zh", now)).toBe("刚刚");
    expect(formatRelativeTime(now - 10_000, "en", now)).toBe("Just now");
    expect(formatRelativeTime(now - 120_000, "en", now)).toBe("2 minutes ago");
    expect(formatRelativeTime(now - 60_000, "en", now)).toBe("1 minute ago");
    expect(formatRelativeTime(now - 120_000, "zh", now)).toBe("2分钟前");
  });

  it("formats short sync durations", () => {
    expect(formatSyncDuration(12)).toBe("12ms");
    expect(formatSyncDuration(1500)).toBe("1.5s");
    expect(formatSyncDuration(12_400)).toBe("12s");
  });
});
