import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyIndexInfo } from "../../domain/index-info";
import { setGatewaysForTests } from "../../gateways";
import { useAppStore } from "../../store/app-store";
import { createMockGateways } from "../../test/mock-gateways";
import { IndexInspector } from "./IndexInspector";

vi.mock("../../platform/runtime", () => ({
  isTauriRuntime: () => true,
}));

afterEach(() => {
  cleanup();
  setGatewaysForTests(null);
  useAppStore.setState({
    workspaceRoot: null,
    isLoading: false,
    error: "",
  });
});

describe("IndexInspector", () => {
  it("renders workspace index stats and rebuilds after confirm", async () => {
    const gateways = createMockGateways();
    gateways.workspace.indexInfoOverrides = {
      persistent: true,
      fileSize: 4096,
      lastReconcileMs: Date.now(),
    };
    setGatewaysForTests(gateways);
    const rebuildIndex = vi.fn(async () => {
      await gateways.workspace.rebuildIndex("/workspace");
    });
    useAppStore.setState({
      workspaceRoot: "/workspace",
      rebuildIndex,
    });
    const user = userEvent.setup();
    const view = render(<IndexInspector />);

    await waitFor(() => {
      expect(view.getByText("磁盘缓存")).toBeInTheDocument();
    });
    expect(view.getAllByText(".memoir/index.sqlite").length).toBeGreaterThan(0);
    expect(view.getByText("笔记")).toBeInTheDocument();

    await user.click(view.getByRole("button", { name: "重建索引" }));
    expect(view.getByRole("dialog", { name: "重建索引" })).toBeInTheDocument();
    expect(view.getByText("确认重建当前工作区的库索引？")).toBeInTheDocument();

    await user.click(view.getByRole("button", { name: "重建" }));
    expect(rebuildIndex).toHaveBeenCalledTimes(1);
    expect(gateways.workspace.rebuildCount).toBe(1);
  });

  it("explains an in-memory index and truncated notes", async () => {
    const gateways = createMockGateways();
    gateways.workspace.getIndexInfo = async () =>
      emptyIndexInfo({
        persistent: false,
        noteCount: 2,
        truncatedCount: 1,
        lastReconcileMs: Date.now(),
      });
    setGatewaysForTests(gateways);
    useAppStore.setState({ workspaceRoot: "/workspace" });
    const view = render(<IndexInspector />);

    await waitFor(() => {
      expect(view.getByText("会话内存")).toBeInTheDocument();
    });
    expect(view.getByText(/无法写入 \.memoir/)).toBeInTheDocument();
    expect(view.getByText(/超过读取上限/)).toBeInTheDocument();
    expect(view.queryByRole("button", { name: "打开索引目录" })).not.toBeInTheDocument();
  });

  it("reveals the index database in the system file manager", async () => {
    const gateways = createMockGateways();
    const revealed: string[] = [];
    gateways.workspace.revealPath = async (path) => {
      revealed.push(path);
    };
    setGatewaysForTests(gateways);
    useAppStore.setState({ workspaceRoot: "/notes" });
    const user = userEvent.setup();
    const view = render(<IndexInspector />);

    await waitFor(() => {
      expect(view.getByRole("button", { name: "打开索引目录" })).toBeInTheDocument();
    });
    await user.click(view.getByRole("button", { name: "打开索引目录" }));
    expect(revealed).toEqual(["/notes/.memoir/index.sqlite"]);
  });
});
