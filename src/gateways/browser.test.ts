import { describe, expect, it } from "vitest";
import { BrowserWorkspaceGateway } from "./browser";

describe("BrowserWorkspaceGateway", () => {
  it("writes multiple tags into the new note frontmatter", async () => {
    const gateway = new BrowserWorkspaceGateway();
    const path = await gateway.createNote({
      root: "demo://memoir",
      title: "New Practice",
      extension: "md",
      folder: "LeetCode",
      tags: ["leetcode", "rust"],
    });

    expect(path).toBe("LeetCode/new-practice.md");
    expect(await gateway.readNote("demo://memoir", path)).toContain(
      'tags: ["leetcode", "rust"]',
    );
  });
});
