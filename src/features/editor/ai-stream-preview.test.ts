import { describe, expect, it } from "vitest";
import { streamedMessage } from "./ai-stream-preview";

describe("streamed message preview", () => {
  it("decodes completed escapes and holds incomplete escapes", () => {
    expect(streamedMessage('{"message":"**你好**\\nnext\\u4f')).toBe("**你好**\nnext");
    expect(streamedMessage('{"message":"a\\"b\\\\c')).toBe('a"b\\c');
  });
  it("never displays replacement source or the JSON envelope", () => {
    expect(streamedMessage('{"edit":{"message":"hidden","replacement":"private"},"message":"Visible')).toBe("Visible");
    expect(streamedMessage('{"edit":{"replacement":"private')).toBe("");
    expect(streamedMessage('```json\n{"message":"Done","edit":{"replacement":"private')).toBe("Done");
    expect(streamedMessage('{"mes')).toBe("");
  });
});
