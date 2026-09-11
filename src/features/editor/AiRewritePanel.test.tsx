import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { setGatewaysForTests } from "../../gateways";
import { createMockGateways } from "../../test/mock-gateways";
import { AiRewritePanel } from "./AiRewritePanel";

const target = {
  path: "notes.md",
  from: 0,
  to: 9,
  source: "原文内容",
  scope: "document" as const,
};

afterEach(() => {
  cleanup();
  setGatewaysForTests(null);
});

describe("AiRewritePanel", () => {
  it("sends with Enter and keeps Shift+Enter for a new line", async () => {
    const gateways = createMockGateways();
    gateways.workspace.chatResult = { message: "完成", edit: null };
    setGatewaysForTests(gateways);
    const user = userEvent.setup();
    const view = render(
      <AiRewritePanel
        onApply={() => true}
        onClose={() => undefined}
        onRefreshTarget={() => target}
        onSave={async () => true}
        workspaceRoot="/workspace"
        settings={{ ...DEFAULT_SETTINGS.ai, enabled: true }}
        target={target}
      />,
    );
    const textbox = view.getByRole("textbox", { name: "输入你的要求" });

    await user.type(textbox, "第一行{shift>}{enter}{/shift}第二行");
    expect(textbox).toHaveValue("第一行\n第二行");
    expect(gateways.workspace.chatCalls).toHaveLength(0);

    await user.type(textbox, "{enter}");

    await waitFor(() => expect(gateways.workspace.chatCalls).toHaveLength(1));
    expect(gateways.workspace.chatCalls[0]?.messages).toEqual([
      { role: "user", content: "第一行\n第二行" },
    ]);
  });

  it("does not send when Enter confirms an IME composition", async () => {
    const gateways = createMockGateways();
    setGatewaysForTests(gateways);
    const user = userEvent.setup();
    const view = render(
      <AiRewritePanel
        onApply={() => true}
        onClose={() => undefined}
        onRefreshTarget={() => target}
        onSave={async () => true}
        workspaceRoot="/workspace"
        settings={{ ...DEFAULT_SETTINGS.ai, enabled: true }}
        target={target}
      />,
    );
    const textbox = view.getByRole("textbox", { name: "输入你的要求" });

    await user.type(textbox, "中文输入");
    fireEvent.keyDown(textbox, { key: "Enter", isComposing: true, keyCode: 229 });

    expect(gateways.workspace.chatCalls).toHaveLength(0);
    expect(textbox).toHaveValue("中文输入");
  });

  it("keeps a conversation and shows a reviewable diff", async () => {
    const gateways = createMockGateways();
    gateways.workspace.chatResult = {
      message: "我准备了一个修改，请先审阅。",
      edit: { tool: "replace_document", replacement: "修改后的内容" },
    };
    setGatewaysForTests(gateways);
    const user = userEvent.setup();
    const onApply = vi.fn(() => true);
    const view = render(
      <AiRewritePanel
        onApply={onApply}
        onClose={() => undefined}
        onRefreshTarget={() => target}
        onSave={async () => true}
        workspaceRoot="/workspace"
        settings={{ ...DEFAULT_SETTINGS.ai, enabled: true }}
        target={target}
      />,
    );

    await user.type(view.getByRole("textbox", { name: "输入你的要求" }), "请润色");
    await user.click(view.getByRole("button", { name: "发送" }));

    expect(await view.findByText("我准备了一个修改，请先审阅。")).toBeInTheDocument();
    expect(view.getByRole("region", { name: "建议修改" })).toHaveTextContent("修改后的内容");
    expect(view.getByText("+1 -1")).toBeInTheDocument();
    expect(gateways.workspace.chatCalls[0]?.messages).toEqual([{ role: "user", content: "请润色" }]);

    await user.click(view.getByRole("button", { name: "应用" }));
    expect(onApply).toHaveBeenCalledWith({ ...target, replacement: "修改后的内容" });
    expect(view.getByRole("status")).toHaveTextContent("修改已应用");

    gateways.workspace.chatResult = { message: "这是第二轮回复。", edit: null };
    await user.type(view.getByRole("textbox", { name: "输入你的要求" }), "再解释一下");
    await user.click(view.getByRole("button", { name: "发送" }));
    expect(await view.findByText("这是第二轮回复。")).toBeInTheDocument();
    expect(gateways.workspace.chatCalls[1]?.messages).toEqual([
      { role: "user", content: "请润色" },
      { role: "assistant", content: "我准备了一个修改，请先审阅。" },
      { role: "user", content: "再解释一下" },
    ]);
  });

  it("can apply a proposal and save without closing the conversation", async () => {
    const gateways = createMockGateways();
    gateways.workspace.chatResult = {
      message: "已完成。",
      edit: { tool: "replace_document", replacement: "saved" },
    };
    setGatewaysForTests(gateways);
    const onSave = vi.fn(async () => true);
    const user = userEvent.setup();
    const view = render(
      <AiRewritePanel
        onApply={() => true}
        onClose={() => undefined}
        onRefreshTarget={() => target}
        onSave={onSave}
        workspaceRoot="/workspace"
        settings={{ ...DEFAULT_SETTINGS.ai, enabled: true }}
        target={target}
      />,
    );

    await user.type(view.getByRole("textbox", { name: "输入你的要求" }), "保存这个修改");
    await user.click(view.getByRole("button", { name: "发送" }));
    await view.findByRole("region", { name: "建议修改" });
    await user.click(view.getByRole("button", { name: "应用并保存" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(view.getByRole("status")).toHaveTextContent("修改已应用并保存");
    expect(view.getByRole("textbox", { name: "输入你的要求" })).toBeInTheDocument();
  });

  it("keeps the proposal when the editor source became stale", async () => {
    const gateways = createMockGateways();
    gateways.workspace.chatResult = {
      message: "请确认修改。",
      edit: { tool: "replace_document", replacement: "new" },
    };
    setGatewaysForTests(gateways);
    const user = userEvent.setup();
    const view = render(
      <AiRewritePanel
        onApply={() => false}
        onClose={() => undefined}
        onRefreshTarget={() => target}
        onSave={async () => true}
        workspaceRoot="/workspace"
        settings={{ ...DEFAULT_SETTINGS.ai, enabled: true }}
        target={target}
      />,
    );

    await user.type(view.getByRole("textbox", { name: "输入你的要求" }), "改写");
    await user.click(view.getByRole("button", { name: "发送" }));
    await view.findByRole("region", { name: "建议修改" });
    await user.click(view.getByRole("button", { name: "应用" }));

    expect(view.getByRole("alert")).toHaveTextContent("原内容已发生变化");
    expect(view.getByRole("region", { name: "建议修改" })).toBeInTheDocument();
  });

  it("renders a normal assistant reply without an edit proposal", async () => {
    const gateways = createMockGateways();
    gateways.workspace.chatResult = { message: "这篇笔记有三个章节。", edit: null };
    setGatewaysForTests(gateways);
    const user = userEvent.setup();
    const view = render(
      <AiRewritePanel
        onApply={() => true}
        onClose={() => undefined}
        onRefreshTarget={() => target}
        onSave={async () => true}
        workspaceRoot="/workspace"
        settings={{ ...DEFAULT_SETTINGS.ai, enabled: true }}
        target={target}
      />,
    );

    await user.type(view.getByRole("textbox", { name: "输入你的要求" }), "总结一下");
    await user.click(view.getByRole("button", { name: "发送" }));

    expect(await view.findByText("这篇笔记有三个章节。")).toBeInTheDocument();
    expect(view.queryByRole("region", { name: "建议修改" })).not.toBeInTheDocument();
  });

  it("streams Markdown and keeps reasoning and activity out of subsequent prompts", async () => {
    const gateways = createMockGateways();
    let finish: (value: typeof gateways.workspace.chatResult) => void = () => undefined;
    let report: Parameters<typeof gateways.workspace.chatWithNote>[4];
    const chat = vi.fn<typeof gateways.workspace.chatWithNote>().mockImplementation(
      (_root, _settings, _messages, _target, onProgress) => new Promise((resolve) => {
        finish = resolve;
        report = onProgress;
      }),
    );
    gateways.workspace.chatWithNote = chat;
    setGatewaysForTests(gateways);
    const user = userEvent.setup();
    const view = render(<AiRewritePanel onApply={() => true} onClose={() => undefined}
      onRefreshTarget={() => target} onSave={async () => true} workspaceRoot="/workspace"
      settings={{ ...DEFAULT_SETTINGS.ai, enabled: true }} target={target} />);
    await user.type(view.getByRole("textbox", { name: "输入你的要求" }), "总结{enter}");
    act(() => {
      report?.({ stage: "reasoning", reasoningDelta: "检查**事实**。" });
      report?.({ stage: "receiving", contentDelta: '{"message":"## 结论\\n\\n**重点**' });
    });
    expect(view.getByRole("heading", { name: "结论" })).toBeInTheDocument();
    expect(view.getByText("重点").tagName).toBe("STRONG");
    expect(view.queryByText(/replacement/)).not.toBeInTheDocument();
    await user.click(view.getByText("思考过程"));
    expect(view.getByText("事实").tagName).toBe("STRONG");
    await act(async () => finish({ message: "## 结论\n\n**重点**", edit: null }));
    expect(view.getByText("思考过程").closest("details")).toBeInTheDocument();
    chat.mockResolvedValueOnce({ message: "下一轮", edit: null });
    await user.type(view.getByRole("textbox", { name: "输入你的要求" }), "继续{enter}");
    await view.findByText("下一轮");
    expect(chat.mock.calls[1][2]).toEqual([
      { role: "user", content: "总结" },
      { role: "assistant", content: "## 结论\n\n**重点**" },
      { role: "user", content: "继续" },
    ]);
  });

  it("shows the loading state while a reply is pending", async () => {
    const gateways = createMockGateways();
    let resolveChat: (value: typeof gateways.workspace.chatResult) => void = () => undefined;
    let reportProgress: ((progress: { stage: "toolCompleted"; tool: string; resultCount: number }) => void) | undefined;
    gateways.workspace.chatWithNote = vi.fn(
      (_root, _settings, _messages, _target, onProgress) =>
        new Promise<typeof gateways.workspace.chatResult>((resolve) => {
          resolveChat = resolve;
          reportProgress = onProgress as typeof reportProgress;
          onProgress?.({ stage: "callingTool", tool: "search_notes", query: "招商银行" });
        }),
    );
    setGatewaysForTests(gateways);
    const user = userEvent.setup();
    const view = render(
      <AiRewritePanel
        onApply={() => true}
        onClose={() => undefined}
        onRefreshTarget={() => target}
        onSave={async () => true}
        workspaceRoot="/workspace"
        settings={{ ...DEFAULT_SETTINGS.ai, enabled: true }}
        target={target}
      />,
    );

    await user.type(view.getByRole("textbox", { name: "输入你的要求" }), "改写");
    await user.click(view.getByRole("button", { name: "发送" }));
    expect(view.getByRole("status")).toHaveTextContent("正在调用工具 search_notes");
    expect(view.getByRole("status")).toHaveTextContent("招商银行");

    act(() => reportProgress?.({ stage: "toolCompleted", tool: "search_notes", resultCount: 3 }));
    expect(view.getByRole("status")).toHaveTextContent("命中 3 条笔记");

    await act(async () => resolveChat({ message: "完成", edit: null }));
    expect(await view.findByText("完成")).toBeInTheDocument();
  });
});
