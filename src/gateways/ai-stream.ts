import type { AiChatProgress } from "../domain/ai";
import { GatewayError } from "../domain/errors";

export type ChatToolCall = {
  id: string;
  type: string;
  function: { name: string; arguments: string };
};
export type ChatCompletionMessage = {
  content?: string | null;
  reasoning_content?: string;
  reasoning?: string;
  tool_calls?: ChatToolCall[];
};

type Completion = {
  error?: { message?: string };
  choices?: Array<{
    index?: number;
    message?: ChatCompletionMessage;
    delta?: Omit<ChatCompletionMessage, "tool_calls"> & {
      tool_calls?: Array<Omit<Partial<ChatToolCall>, "function"> & { index: number; function?: Partial<ChatToolCall["function"]> }>;
    };
    finish_reason?: string | null;
  }>;
};

function invalidStream() {
  return new GatewayError({ code: "serialization", message: "AI returned an incomplete or invalid stream. Please try again." });
}

/** POST-based SSE with UTF-8 decoding, multiline data and fragmented tool calls. */
export async function readChatCompletion(
  response: Response,
  report: (progress: AiChatProgress) => void,
): Promise<ChatCompletionMessage> {
  if (!response.ok) {
    throw new GatewayError({ code: "io", message: `AI request failed with HTTP ${response.status}.` });
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
    const body = await response.json().catch(() => { throw invalidStream(); }) as Completion;
    const choice = body.choices?.[0];
    if (body.error || !choice?.message || (choice.finish_reason && !["stop", "tool_calls"].includes(choice.finish_reason))) {
      throw invalidStream();
    }
    const reasoning = choice.message.reasoning_content || choice.message.reasoning;
    if (reasoning) report({ stage: "reasoning", reasoningDelta: reasoning });
    return choice.message;
  }
  const reader = response.body?.getReader();
  if (!reader) throw invalidStream();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let done = false;
  let finished = false;
  let content = "";
  let reasoning = "";
  const calls = new Map<number, ChatToolCall>();
  const dispatch = () => {
    if (!data.length) return;
    const payload = data.join("\n");
    data = [];
    if (payload.trim() === "[DONE]") { done = true; return; }
    let chunk: Completion;
    try { chunk = JSON.parse(payload); } catch { throw invalidStream(); }
    if (chunk.error) throw invalidStream();
    const choice = chunk.choices?.find((item) => (item.index ?? 0) === 0);
    if (!choice) return; // Usage-only chunks and keepalives.
    if (choice.finish_reason) {
      if (!["stop", "tool_calls"].includes(choice.finish_reason)) throw invalidStream();
      finished = true;
    }
    const delta = choice.delta;
    if (!delta) return;
    const thought = delta.reasoning_content || delta.reasoning;
    if (thought) {
      reasoning += thought;
      report({ stage: "reasoning", reasoningDelta: thought });
    }
    if (typeof delta.content === "string" && delta.content) {
      content += delta.content;
      report({ stage: "receiving", contentDelta: delta.content });
    }
    for (const part of delta.tool_calls ?? []) {
      if (!Number.isInteger(part.index) || part.index < 0 || part.index > 64) throw invalidStream();
      const call = calls.get(part.index) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
      call.id += part.id ?? "";
      if (part.type) call.type = part.type;
      call.function.name += part.function?.name ?? "";
      call.function.arguments += part.function?.arguments ?? "";
      calls.set(part.index, call);
      report({ stage: "preparingTool", tool: call.function.name || undefined });
    }
  };
  try {
    while (!done) {
      const next = await reader.read();
      buffer += decoder.decode(next.value, { stream: !next.done });
      // Keep a trailing CR until the next read, in case it is half of CRLF.
      while (true) {
        const match = /\r\n|\r|\n/.exec(buffer);
        if (!match || (!next.done && match[0] === "\r" && match.index === buffer.length - 1)) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (!line) dispatch();
        else if (line === "data" || line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        if (done) break;
      }
      if (next.done) break;
    }
    if (!done && !finished) throw invalidStream();
    return {
      content,
      reasoning_content: reasoning || undefined,
      tool_calls: [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call),
    };
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
