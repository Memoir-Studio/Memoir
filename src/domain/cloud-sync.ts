export const CLOUD_PROVIDER_IDS = ["webdav"] as const;
export type CloudProviderId = (typeof CLOUD_PROVIDER_IDS)[number];

export type CloudSyncStatus = "idle" | "ok" | "error";

export type WebDavSettings = {
  url: string;
  username: string;
  password: string;
  insecureTls: boolean;
};

export type CloudSyncFileError = {
  path: string;
  message: string;
};

export type CloudSyncReport = {
  uploaded: number;
  downloaded: number;
  deletedRemote: number;
  deletedLocal: number;
  skipped: number;
  conflicts: number;
  errors: CloudSyncFileError[];
  completedMs: number;
};

export type CloudSyncProfile = {
  enabled: boolean;
  provider: CloudProviderId;
  remotePrefix: string;
  webdav: WebDavSettings;
  lastSyncMs: number | null;
  lastStatus: CloudSyncStatus;
  lastError: string | null;
  lastReport: CloudSyncReport | null;
};

export type CloudSyncProfileInput = {
  enabled: boolean;
  provider: CloudProviderId;
  remotePrefix: string;
  webdav: WebDavSettings;
};

export type CloudSyncProbe = {
  ok: boolean;
  message: string;
};

export type CloudSyncRunResult = {
  profile: CloudSyncProfile;
  report: CloudSyncReport;
};

export const DEFAULT_WEBDAV_SETTINGS: WebDavSettings = {
  url: "",
  username: "",
  password: "",
  insecureTls: false,
};

export function defaultCloudSyncProfile(): CloudSyncProfile {
  return {
    enabled: false,
    provider: "webdav",
    remotePrefix: "",
    webdav: { ...DEFAULT_WEBDAV_SETTINGS },
    lastSyncMs: null,
    lastStatus: "idle",
    lastError: null,
    lastReport: null,
  };
}

export function isCloudProviderId(value: unknown): value is CloudProviderId {
  return CLOUD_PROVIDER_IDS.includes(value as CloudProviderId);
}

export function isCloudSyncStatus(value: unknown): value is CloudSyncStatus {
  return value === "idle" || value === "ok" || value === "error";
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

export function mergeWebDavSettings(settings?: Partial<WebDavSettings> | null): WebDavSettings {
  return {
    url: asTrimmedString(settings?.url),
    username: asTrimmedString(settings?.username),
    password: typeof settings?.password === "string" ? settings.password : "",
    insecureTls: asBoolean(settings?.insecureTls, false),
  };
}

export function mergeCloudSyncReport(report?: Partial<CloudSyncReport> | null): CloudSyncReport | null {
  if (!report) return null;
  const errors = Array.isArray(report.errors)
    ? report.errors
        .map((item) => ({
          path: asTrimmedString((item as CloudSyncFileError | undefined)?.path),
          message: asTrimmedString((item as CloudSyncFileError | undefined)?.message),
        }))
        .filter((item) => item.path || item.message)
    : [];
  return {
    uploaded: asFiniteNumber(report.uploaded) ?? 0,
    downloaded: asFiniteNumber(report.downloaded) ?? 0,
    deletedRemote: asFiniteNumber(report.deletedRemote) ?? 0,
    deletedLocal: asFiniteNumber(report.deletedLocal) ?? 0,
    skipped: asFiniteNumber(report.skipped) ?? 0,
    conflicts: asFiniteNumber(report.conflicts) ?? 0,
    errors,
    completedMs: asFiniteNumber(report.completedMs) ?? 0,
  };
}

export function mergeCloudSyncProfile(
  profile?: Partial<CloudSyncProfile> | null,
): CloudSyncProfile {
  const defaults = defaultCloudSyncProfile();
  return {
    enabled: asBoolean(profile?.enabled, defaults.enabled),
    provider: isCloudProviderId(profile?.provider) ? profile.provider : defaults.provider,
    remotePrefix: asTrimmedString(profile?.remotePrefix).replace(/^\/+|\/+$/g, ""),
    webdav: mergeWebDavSettings(profile?.webdav),
    lastSyncMs: asFiniteNumber(profile?.lastSyncMs),
    lastStatus: isCloudSyncStatus(profile?.lastStatus) ? profile.lastStatus : defaults.lastStatus,
    lastError: typeof profile?.lastError === "string" && profile.lastError.trim()
      ? profile.lastError.trim()
      : null,
    lastReport: mergeCloudSyncReport(profile?.lastReport),
  };
}

export function toCloudSyncProfileInput(profile: CloudSyncProfile): CloudSyncProfileInput {
  return {
    enabled: profile.enabled,
    provider: profile.provider,
    remotePrefix: profile.remotePrefix,
    webdav: { ...profile.webdav },
  };
}

export function hasCloudSyncCredentials(profile: CloudSyncProfileInput): boolean {
  if (profile.provider === "webdav") {
    return Boolean(profile.webdav.url);
  }
  return false;
}
