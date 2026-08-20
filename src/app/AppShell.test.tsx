import { act, cleanup, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { resetAppUpdateCheckForTests } from "../features/update/useAppUpdateCheck";
import { setGatewaysForTests } from "../gateways";
import { useAppStore } from "../store/app-store";
import { createMockGateways } from "../test/mock-gateways";
import AppShell from "./AppShell";

afterEach(() => {
  cleanup();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  setGatewaysForTests(null);
  resetAppUpdateCheckForTests();
  useAppStore.setState({
    workspaceRoot: null,
    notes: [],
    folderAppearances: {},
    initialized: true,
    isLoading: false,
    activePath: null,
    loadedContentPath: null,
    content: "",
    savedContent: "",
    error: "",
    navFilter: "all",
    scopedFilter: null,
    attachments: [],
    libraryPanelMode: "notes",
  });
});

describe("AppShell folder appearance", () => {
  it("loads demo folders and saves a custom emoji", async () => {
    const user = userEvent.setup();
    const view = render(<AppShell />);

    await waitFor(() => {
      expect(view.getByRole("button", { name: /load demo notes|载入演示文档/i })).toBeInTheDocument();
    });

    await user.click(view.getByRole("button", { name: /load demo notes|载入演示文档/i }));

    await waitFor(() => {
      expect(view.getByText("日记")).toBeInTheDocument();
      expect(view.getByText("思考")).toBeInTheDocument();
      expect(view.getByText("LeetCode")).toBeInTheDocument();
    });

    const diaryRow = view.getByRole("button", { name: "日记" }).closest(".sidebar-folder-item");
    expect(diaryRow).toBeTruthy();
    await user.click(
      within(diaryRow as HTMLElement).getByRole("button", {
        name: /自定义外观|customize appearance/i,
      }),
    );
    expect(view.getByRole("dialog", { name: /自定义文件夹|customize folder/i })).toBeInTheDocument();

    await user.click(view.getByRole("button", { name: "📔" }));
    await waitFor(() => {
      expect(useAppStore.getState().folderAppearances.日记).toEqual({ emoji: "📔" });
    });
    expect(view.getAllByText("📔").length).toBeGreaterThan(0);
  });
});

describe("AppShell window chrome", () => {
  it("shows window controls on the empty workspace screen in the desktop runtime", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
    setGatewaysForTests(createMockGateways());
    const initialize = useAppStore.getState().initialize;
    useAppStore.setState({
      initialize: async () => undefined,
      initialized: true,
      workspaceRoot: null,
    });

    try {
      const view = render(<AppShell />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(view.getByRole("button", { name: /关闭窗口|close window/i })).toBeInTheDocument();
      expect(view.getByRole("button", { name: /最小化|minimize/i })).toBeInTheDocument();
      expect(view.getByRole("button", { name: /最大化|maximize/i })).toBeInTheDocument();
      expect(view.getByRole("button", { name: /打开文件夹|open folder/i })).toBeInTheDocument();
      expect(document.querySelector(".memoir-window-drag-bar")).toBeTruthy();
    } finally {
      useAppStore.setState({ initialize });
    }
  });
});
