import type { AppLocale } from "../domain/settings";
import { en } from "./en";
import { zh, type MessageKey } from "./zh";

export type { MessageKey };
export type MessageParams = Record<string, string | number>;

const catalogs: Record<AppLocale, Record<MessageKey, string>> = {
  zh,
  en,
};

export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  );
}

export function t(locale: AppLocale, key: MessageKey, params?: MessageParams): string {
  const message = catalogs[locale][key] ?? catalogs.zh[key] ?? key;
  return interpolate(message, params);
}

export function tc(
  locale: AppLocale,
  key: MessageKey,
  count: number,
  params?: MessageParams,
): string {
  const oneKey = `${key}_one`;
  const resolved =
    locale === "en" && count === 1 && oneKey in catalogs.en ? (oneKey as MessageKey) : key;
  return t(locale, resolved, { count, ...params });
}

export const messageKeys = Object.keys(zh) as MessageKey[];
