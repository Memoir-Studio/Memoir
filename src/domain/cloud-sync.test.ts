import { describe, expect, it } from "vitest";
import {
  defaultCloudSyncProfile,
  hasCloudSyncCredentials,
  mergeCloudSyncProfile,
} from "./cloud-sync";

describe("cloud sync profile", () => {
  it("defaults an empty profile and ignores unknown providers", () => {
    expect(mergeCloudSyncProfile(null)).toEqual(defaultCloudSyncProfile());
    expect(
      mergeCloudSyncProfile({
        provider: "s3" as never,
        remotePrefix: "/Memoir/notes/",
        enabled: true,
        webdav: { url: " https://dav.example/ ", username: "ada", password: "secret", insecureTls: true },
      }),
    ).toEqual({
      enabled: true,
      provider: "webdav",
      remotePrefix: "Memoir/notes",
      webdav: {
        url: "https://dav.example/",
        username: "ada",
        password: "secret",
        insecureTls: true,
      },
      lastSyncMs: null,
      lastStatus: "idle",
      lastError: null,
      lastReport: null,
    });
  });

  it("keeps last sync metadata and treats a WebDAV URL as enough to connect", () => {
    const merged = mergeCloudSyncProfile({
      lastSyncMs: 1_700_000_000_000,
      lastStatus: "error",
      lastError: "  unauthorized  ",
      lastReport: {
        uploaded: 2,
        downloaded: "1" as unknown as number,
        deletedRemote: 0,
        deletedLocal: 0,
        skipped: 0,
        conflicts: 0,
        completedMs: 0,
        errors: [{ path: "a.md", message: "boom" }],
      },
    });
    expect(merged.lastSyncMs).toBe(1_700_000_000_000);
    expect(merged.lastStatus).toBe("error");
    expect(merged.lastError).toBe("unauthorized");
    expect(merged.lastReport).toMatchObject({
      uploaded: 2,
      downloaded: 1,
      errors: [{ path: "a.md", message: "boom" }],
    });
    expect(hasCloudSyncCredentials(merged)).toBe(false);
    expect(
      hasCloudSyncCredentials({
        ...merged,
        webdav: { ...merged.webdav, url: "https://dav.example/remote.php/dav/" },
      }),
    ).toBe(true);
  });
});
