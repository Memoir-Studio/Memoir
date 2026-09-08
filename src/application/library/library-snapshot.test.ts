import { describe, expect, it } from "vitest";
import { createMockGateways } from "../../test/mock-gateways";
import { loadWorkspaceSnapshot } from "./library-use-cases";

describe("workspace snapshot use case", () => {
  it("loads the indexed page and attachments together", async () => {
    const gateways = createMockGateways();
    const snapshot = await loadWorkspaceSnapshot(gateways, "/workspace", {
      q: "",
      nav: "all",
      folder: null,
      tag: null,
      nowMs: 1,
    });
    expect(snapshot.page.notes).toHaveLength(1);
    expect(snapshot.attachments).toEqual([]);
  });
});
