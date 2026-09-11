import { describe, expect, it, vi } from "vitest";
import { readChatCompletion } from "./ai-stream";

function response(text: string, chunkSize = 1) {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(offset, offset += chunkSize));
    },
  }), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
}
const event = (delta: object, finish_reason: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`;

describe("chat SSE", () => {
  it.each(["\n", "\r\n", "\r"])("decodes UTF-8 and fragmented tool arguments with %j separators", async (separator) => {
    const report = vi.fn();
    const wire = ': keepalive\n\n' +
      event({ reasoning_content: "检查笔记。" }) +
      event({ content: '{"message":"你' }) + event({ content: '好","edit":null}' }) +
      event({ tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "search_notes", arguments: '{"que' } }] }) +
      event({ tool_calls: [{ index: 0, function: { arguments: 'ry":"中文"}' } }] }, "tool_calls") +
      'data: [DONE]\n\n';
    const result = await readChatCompletion(response(wire.split("\n").join(separator)), report);
    expect(result.content).toBe('{"message":"你好","edit":null}');
    expect(result.reasoning_content).toBe("检查笔记。");
    expect(result.tool_calls?.[0]).toEqual({ id: "call-1", type: "function", function: { name: "search_notes", arguments: '{"query":"中文"}' } });
    expect(report).toHaveBeenCalledWith({ stage: "reasoning", reasoningDelta: "检查笔记。" });
    expect(report).toHaveBeenCalledWith({ stage: "receiving", contentDelta: '{"message":"你' });
  });

  it("joins multiline data and accepts a finish event without DONE", async () => {
    const wire = 'data: {"choices":\ndata: [{"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\n';
    expect((await readChatCompletion(response(wire), vi.fn())).content).toBe("answer");
  });

  it.each([
    event({ content: '{"message":"truncated' }),
    event({ content: "answer" }, "length") + 'data: [DONE]\n\n',
    'data: {"error":{"message":"failed"}}\n\n',
    'data: invalid\n\n',
  ])("rejects broken streams", async (wire) => {
    await expect(readChatCompletion(response(wire), vi.fn())).rejects.toMatchObject({ code: "serialization" });
  });

  it("accepts a regular JSON response and forwards provider reasoning", async () => {
    const report = vi.fn();
    const message = { content: "answer", reasoning_content: "Check facts" };
    expect(await readChatCompletion(Response.json({ choices: [{ message }] }), report)).toEqual(message);
    expect(report).toHaveBeenCalledWith({ stage: "reasoning", reasoningDelta: "Check facts" });
  });
});
