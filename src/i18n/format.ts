import type { AppLocale } from "../domain/settings";
import { dateLocale } from "./locale";
import { t, tc } from "./translate";

export function formatSyncDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

export function formatRelativeTime(ms: number, locale: AppLocale, now = Date.now()): string {
  if (!ms) return t(locale, "time.unknown");
  const delta = now - ms;
  if (delta < 60_000) return t(locale, "time.justNow");
  if (delta < 3_600_000) {
    return tc(locale, "time.minutesAgo", Math.max(1, Math.floor(delta / 60_000)));
  }
  if (delta < 86_400_000) {
    return tc(locale, "time.hoursAgo", Math.floor(delta / 3_600_000));
  }
  return new Date(ms).toLocaleDateString(dateLocale(locale));
}
