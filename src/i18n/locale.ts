import type { AppLocale, LocalePreference } from "../domain/settings";

export type { AppLocale, LocalePreference };

export function isAppLocale(value: unknown): value is AppLocale {
  return value === "zh" || value === "en";
}

export function detectSystemLocale(language?: string): AppLocale {
  const value =
    language ?? (typeof navigator !== "undefined" ? navigator.language : "en");
  return value.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function resolveLocale(
  preference: LocalePreference | undefined,
  language?: string,
): AppLocale {
  if (isAppLocale(preference)) return preference;
  return detectSystemLocale(language);
}

export function htmlLang(locale: AppLocale): string {
  return locale === "zh" ? "zh-CN" : "en";
}

export function dateLocale(locale: AppLocale): string {
  return locale === "zh" ? "zh-CN" : "en";
}
