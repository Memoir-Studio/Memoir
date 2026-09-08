import { describe, expect, it } from "vitest";
import { createMockGateways } from "../../test/mock-gateways";
import { prepareLibraryProjection } from "./library-use-cases";

describe("library use cases", () => {
  it("projects favorites, folder appearances, and drafts without UI state", async () => {
    const gateways = createMockGateways();
    gateways.persistence.state.favorites = { "/workspace": ["one.md"] };
    gateways.persistence.state.folderAppearances = {
      "/workspace": { notes: { emoji: "📔" } },
    };
    gateways.persistence.drafts.set("/workspace:one.md", "# Draft title");
    const page = await gateways.workspace.queryLibrary("/workspace", {
      q: "",
      nav: "all",
      folder: null,
      tag: null,
      nowMs: 1,
    });

    const projection = await prepareLibraryProjection(gateways, "/workspace", page);

    expect(projection.favoritePaths).toEqual(["one.md"]);
    expect(projection.notes[0]).toMatchObject({
      relativePath: "one.md",
      title: "Draft title",
      dirty: true,
      favorite: true,
    });
    expect(projection.folderAppearances).toEqual({ notes: { emoji: "📔" } });
  });
});
