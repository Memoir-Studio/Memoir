import { describe, expect, it } from "vitest";
import { setGatewaysForTests } from "../../gateways";
import { createMockGateways } from "../../test/mock-gateways";
import {
  mergeRecentWorkspaces,
  revealWorkspaceItem,
  workspaceDisplayName,
  workspaceInitial,
} from "./workspace-utils";

describe("workspace utils", () => {
  it("reads the last path segment as the workspace name", () => {
    expect(workspaceDisplayName("/home/shiyu/日记", "工作区")).toBe("日记");
    expect(workspaceDisplayName("C:\\Users\\me\\Notes\\", "Workspace")).toBe("Notes");
    expect(workspaceDisplayName("demo://memoir", "Workspace")).toBe("memoir");
    expect(workspaceDisplayName(null, "工作区")).toBe("工作区");
    expect(workspaceDisplayName("/", "工作区")).toBe("工作区");
  });

  it("uses the first character as an avatar initial", () => {
    expect(workspaceInitial("日记")).toBe("日");
    expect(workspaceInitial("memoir")).toBe("M");
    expect(workspaceInitial("")).toBe("M");
  });

  it("keeps the current workspace first and preserves recency", () => {
    expect(mergeRecentWorkspaces("/b", ["/a", "/b", "/c"])).toEqual(["/b", "/a", "/c"]);
    expect(mergeRecentWorkspaces(null, ["/a", "/a"])).toEqual(["/a"]);
    expect(mergeRecentWorkspaces("/only", [])).toEqual(["/only"]);
  });

  it("reveals a workspace-relative path through the gateway", async () => {
    const gateways = createMockGateways();
    const revealed: string[] = [];
    gateways.workspace.revealPath = async (path) => {
      revealed.push(path);
    };
    setGatewaysForTests(gateways);
    try {
      await revealWorkspaceItem("/notes", "思考", "今天吃什么.mdx");
      expect(revealed).toEqual(["/notes/思考/今天吃什么.mdx"]);
    } finally {
      setGatewaysForTests(null);
    }
  });
});
