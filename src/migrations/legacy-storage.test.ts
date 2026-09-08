import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistenceGateway } from "../gateways/contracts";
import { migrateLegacyStorage } from "./legacy-storage";

const tauriWindow = window as Window & { __TAURI_INTERNALS__?: object };

afterEach(() => {
  window.localStorage.clear();
  delete tauriWindow.__TAURI_INTERNALS__;
});

describe("legacy storage migration", () => {
  it("only removes keys confirmed by the persistence gateway", async () => {
    tauriWindow.__TAURI_INTERNALS__ = {};
    window.localStorage.setItem("memoir:last-workspace", "/notes");
    window.localStorage.setItem("memoir:draft:/notes:one.md", "# One");
    window.localStorage.setItem("memoir:draft:/notes:two.md", "# Two");
    const migrateLegacyState = vi.fn().mockResolvedValue({
      migratedKeys: ["memoir:last-workspace", "memoir:draft:/notes:one.md"],
    });
    const persistence = { migrateLegacyState } as unknown as PersistenceGateway;

    await migrateLegacyStorage(persistence);

    expect(migrateLegacyState).toHaveBeenCalledWith({
      settings: undefined,
      lastWorkspace: "/notes",
      sidebarCollapsed: undefined,
      favorites: undefined,
      drafts: [
        {
          legacyKey: "memoir:draft:/notes:one.md",
          content: "# One",
        },
        {
          legacyKey: "memoir:draft:/notes:two.md",
          content: "# Two",
        },
      ],
    });
    expect(window.localStorage.getItem("memoir:last-workspace")).toBeNull();
    expect(window.localStorage.getItem("memoir:draft:/notes:one.md")).toBeNull();
    expect(window.localStorage.getItem("memoir:draft:/notes:two.md")).toBe("# Two");
    expect(window.localStorage.getItem("memoir:legacy-migrated")).toBeNull();
  });
});
