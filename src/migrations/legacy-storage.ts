import type { LegacyStatePayload } from "../domain/app-state";
import { mergeSettings, type AppSettings } from "../domain/settings";
import type { PersistenceGateway } from "../gateways/contracts";
import { isTauriRuntime } from "../platform/runtime";

const SETTINGS_KEY = "memoir:settings";
const LEGACY_THEME_KEY = "memoir:theme";
const LAST_WORKSPACE_KEY = "memoir:last-workspace";
const FAVORITES_KEY = "memoir:favorites";
const SIDEBAR_COLLAPSED_KEY = "memoir:sidebar-collapsed";
const DRAFT_PREFIX = "memoir:draft:";
const MIGRATION_MARKER = "memoir:legacy-migrated";

function parseJson<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function collectLegacyState(storage: Storage): {
  payload: LegacyStatePayload;
  keys: string[];
} {
  const keys: string[] = [];
  const serializedSettings = storage.getItem(SETTINGS_KEY);
  const storedSettings = parseJson<Partial<AppSettings>>(serializedSettings);
  const legacyTheme = storage.getItem(LEGACY_THEME_KEY);
  const lastWorkspace = storage.getItem(LAST_WORKSPACE_KEY) || undefined;
  const favorites = parseJson<string[]>(storage.getItem(FAVORITES_KEY));
  const sidebar = storage.getItem(SIDEBAR_COLLAPSED_KEY);
  const drafts: LegacyStatePayload["drafts"] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(DRAFT_PREFIX)) continue;
    const content = storage.getItem(key);
    if (content === null) continue;
    keys.push(key);
    drafts.push({ legacyKey: key, content });
  }

  const settings = storedSettings
    ? mergeSettings(storedSettings)
    : legacyTheme === "light" || legacyTheme === "dark"
      ? mergeSettings({ appearance: { theme: legacyTheme } } as Partial<AppSettings>)
      : undefined;

  for (const key of [
    SETTINGS_KEY,
    LEGACY_THEME_KEY,
    LAST_WORKSPACE_KEY,
    FAVORITES_KEY,
    SIDEBAR_COLLAPSED_KEY,
  ]) {
    if (storage.getItem(key) !== null) keys.push(key);
  }

  return {
    payload: {
      settings,
      lastWorkspace,
      sidebarCollapsed: sidebar === null ? undefined : sidebar === "true",
      favorites,
      drafts,
    },
    keys,
  };
}

export async function migrateLegacyStorage(
  persistence: PersistenceGateway,
  storage: Storage = window.localStorage,
) {
  if (!isTauriRuntime() || storage.getItem(MIGRATION_MARKER) === "true") return;
  const { payload, keys } = collectLegacyState(storage);
  if (!keys.length) {
    storage.setItem(MIGRATION_MARKER, "true");
    return;
  }

  const result = await persistence.migrateLegacyState(payload);
  const migrated = new Set(result.migratedKeys);
  for (const key of keys) {
    if (migrated.has(key)) storage.removeItem(key);
  }
  if (keys.every((key) => migrated.has(key))) {
    storage.setItem(MIGRATION_MARKER, "true");
  }
}
