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

  it("toggles document context for requests and ignores edits without context", async () => {
    const gateways = createMockGateways();
    gateways.workspace.chatResult = {
      message: "回答",
      edit: { tool: "replace_document", replacement: "不应应用的修改" },
    };
    setGatewaysForTests(gateways);
    const user = userEvent.setup();
    const view = render(
      <AiRewritePanel onApply={() => true} onClose={() => undefined}
        onRefreshTarget={() => target} onSave={async () => true} workspaceRoot="/workspace"
        settings={{ ...DEFAULT_SETTINGS.ai, enabled: true }} target={target} />,
    );
    const context = view.getByRole("button", { name: "引用当前笔记" });
    expect(context).toHaveAttribute("aria-pressed", "true");
    expect(context).toHaveTextContent("notes");

    await user.click(context);
    expect(context).toHaveAttribute("aria-pressed", "false");
    expect(context).toHaveTextContent("notes");
    await user.type(view.getByRole("textbox"), "你好{enter}");
    await view.findByText("回答");
    expect(gateways.workspace.chatCalls[0].target).toBeNull();
    expect(view.queryByRole("region", { name: "建议修改" })).not.toBeInTheDocument();

    await user.click(context);
    await user.type(view.getByRole("textbox"), "润色{enter}");
    await view.findByRole("region", { name: "建议修改" });
    expect(gateways.workspace.chatCalls[1].target).toEqual(target);
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
});

describe("AI conversation history", () => {
  function panel(root = "/workspace", currentTarget: typeof target | null = target) {
    return <AiRewritePanel onApply={() => true} onClose={() => undefined}
      onRefreshTarget={() => currentTarget} onSave={async () => true} workspaceRoot={root}
      settings={{ ...DEFAULT_SETTINGS.ai, enabled: true }} target={currentTarget} />;
  }

  it("reopens saved conversations after remount and continues with their messages", async () => {
    const gateways = createMockGateways();
    gateways.workspace.chatResult = { message: "历史回答", edit: null };
    setGatewaysForTests(gateways);
    const user = userEvent.setup();
    const first = render(panel());
    await user.type(first.getByRole("textbox"), "最初的问题{enter}");
    await first.findByText("历史回答");
    await user.click(first.getByRole("button", { name: "新对话" }));
    expect(first.queryByText("历史回答")).not.toBeInTheDocument();
    first.unmount();

    const view = render(panel());
    await user.click(view.getByRole("button", { name: "历史对话" }));
    await user.click(view.getByRole("button", { name: /最初的问题.*notes.md/ }));
    expect(view.getByText("历史回答")).toBeInTheDocument();
    expect(view.getByRole("region", { name: "引用笔记" })).toHaveTextContent("notes.md");
    gateways.workspace.chatResult = { message: "接着回答", edit: null };
    await user.type(view.getByRole("textbox"), "继续{enter}");
    await view.findByText("接着回答");
    expect(gateways.workspace.chatCalls[1].messages).toEqual([
      { role: "user", content: "最初的问题" },
      { role: "assistant", content: "历史回答" },
      { role: "user", content: "继续" },
    ]);
    await waitFor(async () => expect((await gateways.persistence.loadAiConversations("/workspace"))[0].messages).toHaveLength(4));
  });

  it("keeps workspace histories separate and allows reading and deleting without an open note", async () => {
    const gateways = createMockGateways();
    gateways.workspace.chatResult = { message: "已有回答", edit: null };
    setGatewaysForTests(gateways);
    const user = userEvent.setup();
    const view = render(panel());
    await user.type(view.getByRole("textbox"), "已有问题{enter}");
    await view.findByText("已有回答");
    view.rerender(panel("/other"));
    await user.click(view.getByRole("button", { name: "历史对话" }));
    expect(await view.findByText("还没有历史对话，发送消息后会自动保存。")).toBeInTheDocument();
    view.rerender(panel("/workspace", null));
    await user.click(view.getByRole("button", { name: "历史对话" }));
    await user.click(view.getByRole("button", { name: /已有问题.*notes.md/ }));
    expect(view.getByText("已有回答")).toBeInTheDocument();
    expect(view.getByRole("textbox")).toBeInTheDocument();
    await user.click(view.getByRole("button", { name: "历史对话" }));
    await user.click(view.getByRole("button", { name: "删除对话：已有问题" }));
    await user.click(view.getByRole("button", { name: "确认删除" }));
    expect(view.getByText("还没有历史对话，发送消息后会自动保存。")).toBeInTheDocument();
    await waitFor(async () => expect(await gateways.persistence.loadAiConversations("/workspace")).toEqual([]));
  });

  it("saves a late reply to its original conversation without polluting a new conversation", async () => {
    const gateways = createMockGateways();
    let finish!: (value: typeof gateways.workspace.chatResult) => void;
    gateways.workspace.chatWithNote = vi.fn(() => new Promise<typeof gateways.workspace.chatResult>((resolve) => { finish = resolve; }));
    setGatewaysForTests(gateways);
    const user = userEvent.setup();
    const view = render(panel());
    await user.type(view.getByRole("textbox"), "等待回复{enter}");
    await user.click(view.getByRole("button", { name: "新对话" }));
    await act(async () => finish({ message: "迟到的回答", edit: { tool: "replace_document", replacement: "不应显示的修改" } }));
    expect(view.queryByText("迟到的回答")).not.toBeInTheDocument();
    expect(view.queryByRole("region", { name: "建议修改" })).not.toBeInTheDocument();
    await user.click(view.getByRole("button", { name: "历史对话" }));
    await user.click(view.getByRole("button", { name: /等待回复.*notes.md/ }));
    expect(view.getByText("迟到的回答")).toBeInTheDocument();
    expect(view.getByRole("region", { name: "建议修改" })).toHaveTextContent("不应显示的修改");
  });

  it("prevents overlapping requests when reopening a conversation that is still receiving a reply", async () => {
    const gateways = createMockGateways();
    let finish!: (value: typeof gateways.workspace.chatResult) => void;
    gateways.workspace.chatWithNote = vi.fn(() => new Promise<typeof gateways.workspace.chatResult>((resolve) => { finish = resolve; }));
    setGatewaysForTests(gateways);
    const user = userEvent.setup();
    const first = render(panel());
    await user.type(first.getByRole("textbox"), "继续等待{enter}");
    first.unmount();
    const view = render(panel());
    await user.click(view.getByRole("button", { name: "历史对话" }));
    await user.click(view.getByRole("button", { name: /继续等待.*notes.md/ }));
    expect(view.getByRole("textbox")).toBeDisabled();
    await act(async () => finish({ message: "最终回复", edit: null }));
    expect(view.getByText("最终回复")).toBeInTheDocument();
    expect(view.getByRole("textbox")).toBeEnabled();
  });
});

describe("background AI panel", () => {
  function setup() {
    const gateways = createMockGateways();
    type Response = typeof gateways.workspace.chatResult;
    const jobs: {
      resolve: (response: Response) => void;
      reject: (error: Error) => void;
      progress: NonNullable<Parameters<typeof gateways.workspace.chatWithNote>[4]>;
    }[] = [];
    gateways.workspace.chatWithNote = vi.fn<typeof gateways.workspace.chatWithNote>((_root, _settings, _messages, _target, progress) =>
      new Promise<Response>((resolve, reject) => jobs.push({ resolve, reject, progress: progress! })));
    setGatewaysForTests(gateways);
    const onApply = vi.fn(() => true);
    const panel = (root = "/workspace", currentTarget = target) => (
      <AiRewritePanel onApply={onApply} onClose={() => undefined} onRefreshTarget={() => currentTarget}
        onSave={async () => true} workspaceRoot={root} settings={DEFAULT_SETTINGS.ai} target={currentTarget} />
    );
    return { gateways, jobs, panel, onApply };
  }

  it("restores the active stream after unmount and keeps multiple sessions running while browsing history", async () => {
    const { jobs, panel, onApply } = setup();
    const user = userEvent.setup();
    const first = render(panel());
    await user.type(first.getByRole("textbox"), "第一个任务{enter}");
    act(() => jobs[0].progress({ stage: "receiving", contentDelta: '{"message":"第一段' }));
    first.unmount();
    act(() => jobs[0].progress({ stage: "receiving", contentDelta: "继续生成" }));
    const view = render(panel());
    expect(view.getByText("第一段继续生成")).toBeInTheDocument();
    expect(view.getByRole("textbox")).toBeDisabled();
    await user.click(view.getByRole("button", { name: "新对话" }));
    await user.type(view.getByRole("textbox"), "第二个任务{enter}");
    act(() => jobs[1].progress({ stage: "receiving", contentDelta: '{"message":"第二段' }));
    await user.click(view.getByRole("button", { name: "历史对话" }));
    expect(view.getByRole("button", { name: /第一个任务.*处理中/ })).toBeInTheDocument();
    expect(view.getByRole("button", { name: /第二个任务.*处理中/ })).toBeInTheDocument();
    act(() => jobs[0].progress({ stage: "receiving", contentDelta: "再更新" }));
    await user.click(view.getByRole("button", { name: /第一个任务.*notes.md/ }));
    expect(view.getByText("第一段继续生成再更新")).toBeInTheDocument();
    expect(view.queryByText("第二段")).not.toBeInTheDocument();
    await act(async () => jobs[1].resolve({ message: "第二个完成", edit: null }));
    expect(view.queryByText("第二个完成")).not.toBeInTheDocument();
    await user.click(view.getByRole("button", { name: "历史对话" }));
    await act(async () => jobs[0].resolve({ message: "第一个完成", edit: { tool: "replace_document", replacement: "后台生成的修改" } }));
    await user.click(view.getByRole("button", { name: /第一个任务.*回复完成/ }));
    expect(view.getByRole("region", { name: "建议修改" })).toHaveTextContent("后台生成的修改");
    expect(onApply).not.toHaveBeenCalled();
    await user.click(view.getByRole("button", { name: "应用" }));
    expect(onApply).toHaveBeenCalledWith({ ...target, replacement: "后台生成的修改" });
  });

  it("keeps a workspace's active session and shows a background failure after returning", async () => {
    const { jobs, panel } = setup();
    const user = userEvent.setup();
    const view = render(panel());
    await user.type(view.getByRole("textbox"), "后台请求{enter}");
    view.rerender(panel("/other", { ...target, path: "other.md" }));
    await act(async () => jobs[0].reject(new Error("连接断开")));
    expect(view.queryByRole("alert")).not.toBeInTheDocument();
    view.rerender(panel());
    expect(view.getByRole("alert")).toHaveTextContent("连接断开");
    expect(view.getByText("后台请求")).toBeInTheDocument();
    expect(view.getByRole("textbox")).toBeEnabled();
    await user.type(view.getByRole("textbox"), "重新请求{enter}");
    await act(async () => jobs[1].resolve({ message: "恢复成功", edit: null }));
    expect(view.queryByRole("alert")).not.toBeInTheDocument();
    expect(view.getByText("恢复成功")).toBeInTheDocument();
  });

  it("preserves each session's draft and original note when the editor target changes", async () => {
    const { jobs, panel, gateways } = setup();
    const user = userEvent.setup();
    const view = render(panel());
    await user.type(view.getByRole("textbox"), "笔记一{enter}");
    view.rerender(panel("/workspace", { ...target, path: "other.md", source: "另一篇" }));
    await act(async () => jobs[0].resolve({ message: "完成一", edit: null }));
    await user.type(view.getByRole("textbox"), "未发送的草稿");
    await user.click(view.getByRole("button", { name: "新对话" }));
    await user.type(view.getByRole("textbox"), "笔记二{enter}");
    await act(async () => jobs[1].resolve({ message: "完成二", edit: null }));
    await user.click(view.getByRole("button", { name: "历史对话" }));
    await user.click(view.getByRole("button", { name: /笔记一.*notes.md/ }));
    expect(view.getByRole("textbox")).toHaveValue("未发送的草稿");
    expect(view.getByRole("button", { name: "引用当前笔记" })).toHaveTextContent("notes");
    await user.type(view.getByRole("textbox"), "{enter}");
    expect(vi.mocked(gateways.workspace.chatWithNote).mock.calls[2][3]).toEqual(target);
    await act(async () => jobs[2].resolve({ message: "完成草稿", edit: null }));
  });
});
