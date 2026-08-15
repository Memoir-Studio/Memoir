import { describe, expect, it } from "vitest";
import {
  collectFolderPaths,
  expandFolderAncestors,
  extractEmoji,
  folderAppearancesForWorkspace,
  isFolderColor,
  normalizeFolderAppearance,
  normalizeFolderKey,
} from "./folders";

describe("folder appearance", () => {
  it("extracts the first emoji grapheme and rejects plain text", () => {
    expect(extractEmoji("📔")).toBe("📔");
    expect(extractEmoji("  💡日记")).toBe("💡");
    expect(extractEmoji("❤️")).toBe("❤️");
    expect(extractEmoji("日记")).toBeUndefined();
    expect(extractEmoji("")).toBeUndefined();
    expect(extractEmoji("A")).toBeUndefined();
  });

  it("normalizes appearance payloads and folder keys", () => {
    expect(normalizeFolderAppearance({ emoji: "📓 work", color: "coral" })).toEqual({
      emoji: "📓",
      color: "coral",
    });
    expect(normalizeFolderAppearance({ emoji: "nope", color: "pink" })).toBeUndefined();
    expect(normalizeFolderAppearance({ color: "violet" })).toEqual({ color: "violet" });
    expect(normalizeFolderKey(" /日记/ ")).toBe("日记");
    expect(normalizeFolderKey("")).toBe("");
    expect(isFolderColor("gold")).toBe(true);
    expect(isFolderColor("orange")).toBe(false);
    expect(expandFolderAncestors(" /工作/项目/ ")).toEqual(["工作", "工作/项目"]);
    expect(expandFolderAncestors("")).toEqual([]);
    expect(collectFolderPaths(["", "工作/项目", "日记", "工作"])).toEqual([
      "工作",
      "工作/项目",
      "日记",
    ]);
  });

  it("keeps valid workspace folder appearances and drops empty ones", () => {
    expect(
      folderAppearancesForWorkspace(
        {
          "/notes": {
            日记: { emoji: "📔", color: "coral" },
            stale: { emoji: "abc" },
          },
          "/other": {
            inbox: { color: "blue" },
          },
        },
        "/notes",
      ),
    ).toEqual({
      日记: { emoji: "📔", color: "coral" },
    });
  });
});
