import { describe, expect, it } from "vitest";
import {
  cloudSyncChangedActiveNote,
  cloudSyncProgressRatio,
  cloudSyncTouchedLocal,
  defaultCloudSyncProfile,
  hasCloudSyncCredentials,
  mergeCloudSyncProfile,
  mergeCloudSyncProgress,
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
        durationMs: 12,
        changedLocalPaths: ["a.md"],
        errors: [{ path: "a.md", message: "boom" }],
      },
    });
    expect(merged.lastSyncMs).toBe(1_700_000_000_000);
    expect(merged.lastStatus).toBe("error");
    expect(merged.lastError).toBe("unauthorized");
    expect(merged.lastReport).toMatchObject({
      uploaded: 2,
      downloaded: 1,
      durationMs: 12,
      changedLocalPaths: ["a.md"],
      errors: [{ path: "a.md", message: "boom" }],
    });
    expect(cloudSyncTouchedLocal(merged.lastReport!)).toBe(true);
    expect(cloudSyncChangedActiveNote(merged.lastReport!, "a.md")).toBe(true);
    expect(cloudSyncChangedActiveNote(merged.lastReport!, "other.md")).toBe(false);
    expect(hasCloudSyncCredentials(merged)).toBe(false);
    expect(
      hasCloudSyncCredentials({
        ...merged,
        webdav: { ...merged.webdav, url: "https://dav.example/remote.php/dav/" },
      }),
    ).toBe(true);
  });

  it("parses live sync progress and a determinate ratio", () => {
    expect(mergeCloudSyncProgress(null)).toBeNull();
    expect(mergeCloudSyncProgress({ phase: "nope" as never })).toBeNull();
    const progress = mergeCloudSyncProgress({
      phase: "working",
      path: " attachments/shot.png ",
      action: "upload",
      current: "3" as unknown as number,
      total: 10,
    });
    expect(progress).toEqual({
      phase: "working",
      path: "attachments/shot.png",
      action: "upload",
      current: 3,
      total: 10,
    });
    expect(cloudSyncProgressRatio(progress!)).toBe(0.3);
    expect(
      cloudSyncProgressRatio({
        phase: "listing",
        path: null,
        action: null,
        current: 0,
        total: 0,
      }),
    ).toBeNull();
  });
});
