import { act, cleanup, render, waitFor } from "@testing-library/react";
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
        settings={{ ...DEFAULT_SETTINGS.ai, enabled: true }}
        target={target}
      />,
    );

    await user.type(view.getByRole("textbox", { name: "输入你的要求" }), "总结一下");
    await user.click(view.getByRole("button", { name: "发送" }));

    expect(await view.findByText("这篇笔记有三个章节。")).toBeInTheDocument();
    expect(view.queryByRole("region", { name: "建议修改" })).not.toBeInTheDocument();
  });

  it("shows the loading state while a reply is pending", async () => {
    const gateways = createMockGateways();
    let resolveChat: (value: typeof gateways.workspace.chatResult) => void = () => undefined;
    gateways.workspace.chatWithNote = vi.fn(
      () =>
        new Promise<typeof gateways.workspace.chatResult>((resolve) => {
          resolveChat = resolve;
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
        settings={{ ...DEFAULT_SETTINGS.ai, enabled: true }}
        target={target}
      />,
    );

    await user.type(view.getByRole("textbox", { name: "输入你的要求" }), "改写");
    await user.click(view.getByRole("button", { name: "发送" }));
    expect(view.getByRole("status")).toHaveTextContent("正在处理请求");

    await act(async () => resolveChat({ message: "完成", edit: null }));
    expect(await view.findByText("完成")).toBeInTheDocument();
  });
});
