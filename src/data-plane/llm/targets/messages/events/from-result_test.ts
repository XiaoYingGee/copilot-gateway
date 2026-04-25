import { assertEquals } from "@std/assert";
import { messagesResultToEvents } from "./from-result.ts";

Deno.test("messagesResultToEvents projects terminal JSON into Messages stream events", () => {
  const frames = Array.from(messagesResultToEvents({
    id: "msg_1",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Hello" }],
    model: "claude-test",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 3, output_tokens: 2 },
  }));

  assertEquals(frames.map((frame) => frame.type), [
    "event",
    "event",
    "event",
    "event",
    "event",
    "event",
  ]);
  assertEquals(frames.map((frame) => frame.event.type), [
    "message_start",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
    "message_delta",
    "message_stop",
  ]);
});

Deno.test("messagesResultToEvents omits signature deltas for text-only thinking blocks", () => {
  const frames = Array.from(messagesResultToEvents({
    id: "msg_text_only_thinking",
    type: "message",
    role: "assistant",
    content: [{ type: "thinking", thinking: "trace" }],
    model: "claude-test",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 2 },
  }));

  assertEquals(
    frames
      .filter((frame) => frame.event.type === "content_block_delta")
      .map((frame) => frame.event),
    [{
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: "trace" },
    }],
  );
});
