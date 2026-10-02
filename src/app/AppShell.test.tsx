import { act, cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_WORKSPACE_LAYOUT } from "../domain/layout";
import { DEFAULT_SETTINGS } from "../domain/settings";
import { resetAppUpdateCheckForTests } from "../features/update/useAppUpdateCheck";
import { setGatewaysForTests } from "../gateways";
import { useAppStore } from "../store/app-store";
import { createMockGateways } from "../test/mock-gateways";
import AppShell from "./AppShell";

beforeAll(async () => {
  // Keep cold module transforms outside waitFor's DOM readiness timeout.
  // Exercise the real components through AppShell's nested Suspense boundaries.
  await Promise.all([
    import("../features/editor/EditorWorkspace"),
    import("../features/editor/EditorPane"),
    import("../features/preview/PreviewPane"),
  ]);
});

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
    layout: DEFAULT_WORKSPACE_LAYOUT,
    isSidebarCollapsed: false,
    settings: DEFAULT_SETTINGS,
  });
});

describe("AppShell AI navigation", () => {
  it("restores the active AI stream after switching sidebar panels", async () => {
    const initialize = useAppStore.getState().initialize;
    const gateways = createMockGateways();
    let finish!: (response: typeof gateways.workspace.chatResult) => void;
    let report!: NonNullable<Parameters<typeof gateways.workspace.chatWithNote>[4]>;
    gateways.workspace.chatWithNote = vi.fn<typeof gateways.workspace.chatWithNote>((_root, _settings, _messages, _target, progress) =>
      new Promise((resolve) => { finish = resolve; report = progress!; }));
    setGatewaysForTests(gateways);
    useAppStore.setState({
      initialize: async () => undefined,
      initialized: true,
      workspaceRoot: "/workspace",
      notes: [
        {
          relativePath: "alpha.md",
          fileName: "alpha.md",
          extension: "md",
          modifiedMs: 1,
          size: 13,
          title: "Alpha Guide",
          tags: [],
          excerpt: "",
          favorite: false,
        },
      ],
      activePath: "alpha.md",
      loadedContentPath: "alpha.md",
      content: "# Alpha Guide",
      savedContent: "# Alpha Guide",
      settings: {
        ...DEFAULT_SETTINGS,
        appearance: { ...DEFAULT_SETTINGS.appearance, locale: "zh" },
        ai: { ...DEFAULT_SETTINGS.ai, enabled: true },
      },
    });

    try {
      const user = userEvent.setup();
      const view = render(<AppShell />);
      await waitFor(() => expect(view.container.querySelector("[data-editor-pane]")).toBeTruthy());

      await user.click(view.getByRole("button", { name: "AI 助手" }));

      expect(useAppStore.getState().libraryPanelMode).toBe("ai");
      expect(view.getByRole("complementary", { name: "AI 助手" })).toHaveTextContent(
        "Alpha Guide",
      );
      await user.type(view.getByRole("textbox", { name: "输入你的要求" }), "后台总结{enter}");
      act(() => report({ stage: "receiving", contentDelta: '{"message":"开始总结' }));
      await user.click(view.getByRole("button", { name: /所有笔记/ }));
      expect(view.queryByRole("complementary", { name: "AI 助手" })).not.toBeInTheDocument();
      act(() => report({ stage: "receiving", contentDelta: "，后台继续" }));
      await user.click(view.getByRole("button", { name: "AI 助手" }));
      expect(view.getByText("开始总结，后台继续")).toBeInTheDocument();
      expect(view.getByRole("textbox", { name: "输入你的要求" })).toBeDisabled();
      await act(async () => finish({ message: "后台总结完成", edit: null }));
      expect(view.getByText("后台总结完成")).toBeInTheDocument();
      expect(gateways.workspace.chatWithNote).toHaveBeenCalledOnce();
    } finally {
      cleanup();
      useAppStore.setState({ initialize });
    }
  });
});

describe("AppShell focus mode", () => {
  it.each([
    { isSidebarCollapsed: false, expandDuringFocus: false },
    { isSidebarCollapsed: true, expandDuringFocus: false },
    { isSidebarCollapsed: false, expandDuringFocus: true },
    { isSidebarCollapsed: true, expandDuringFocus: true },
  ])("restores navigation after focus with collapsed=$isSidebarCollapsed and expandDuringFocus=$expandDuringFocus", async ({ isSidebarCollapsed, expandDuringFocus }) => {
    setGatewaysForTests(createMockGateways());
    const initialize = useAppStore.getState().initialize;
    useAppStore.setState({
      initialize: async () => undefined,
      initialized: true,
      workspaceRoot: "/workspace",
      libraryPanelMode: "outline",
      isSidebarCollapsed,
      layout: { ...DEFAULT_WORKSPACE_LAYOUT, libraryWidth: 330 },
    });
    try {
      const user = userEvent.setup();
      const view = render(<AppShell />);
      const focus = await view.findByRole("button", { name: /专注书写|focus writing/i });
      const editor = view.container.querySelector("[data-editor-workspace]");
      expect(editor).toContainElement(focus);
      await user.click(focus);
      expect(focus).toHaveAttribute("aria-pressed", "true");
      expect(useAppStore.getState().isSidebarCollapsed).toBe(true);
      expect(useAppStore.getState().layout.libraryCollapsed).toBe(true);
      expect(view.queryByRole("separator", { name: /调整导航栏宽度|resize navigation/i })).toBeNull();
      expect(view.queryByRole("separator", { name: /调整笔记列表宽度|resize notes/i })).toBeNull();

      if (expandDuringFocus) {
        await user.click(view.getByRole("button", { name: /展开导航|expand navigation/i }));
        expect(useAppStore.getState().isSidebarCollapsed).toBe(false);
        expect(useAppStore.getState().layout.libraryCollapsed).toBe(true);
      }

      await user.click(view.getByRole("button", { name: /退出专注|exit focus/i }));
      expect(focus).toHaveAttribute("aria-pressed", "false");
      expect(useAppStore.getState().isSidebarCollapsed).toBe(isSidebarCollapsed);
      expect(view.getByRole("button", {
        name: isSidebarCollapsed ? /展开导航|expand navigation/i : /收起导航|collapse navigation/i,
      })).toBeInTheDocument();
      expect(view.getByRole("separator", { name: /调整笔记列表宽度|resize notes/i })).toHaveAttribute("aria-valuenow", "330");
      expect(useAppStore.getState().libraryPanelMode).toBe("outline");
      expect(view.container.querySelector("[data-editor-workspace]")).toBe(editor);
    } finally {
      cleanup();
      useAppStore.setState({ initialize, isSidebarCollapsed: false });
    }
  });
});
