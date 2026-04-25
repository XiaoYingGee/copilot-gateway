import { assertEquals } from "@std/assert";
import { chatCompletionResultToEvents } from "./from-result.ts";

Deno.test("chatCompletionResultToEvents projects terminal JSON into Chat stream chunks", () => {
  const frames = Array.from(chatCompletionResultToEvents({
    id: "chatcmpl_1",
    object: "chat.completion",
    created: 123,
    model: "gpt-test",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        reasoning_text: "think",
        content: "Hello",
      },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  }));

  assertEquals(frames.map((frame) => frame.type), [
    "event",
    "event",
    "event",
    "event",
    "event",
    "done",
  ]);
  assertEquals(frames[0], {
    type: "event",
    event: {
      id: "chatcmpl_1",
      object: "chat.completion.chunk",
      created: 123,
      model: "gpt-test",
      choices: [{
        index: 0,
        delta: { role: "assistant" },
        finish_reason: null,
      }],
    },
  });
});

Deno.test("chatCompletionResultToEvents can hide usage chunks for client-visible streams", () => {
  const frames = Array.from(chatCompletionResultToEvents({
    id: "chatcmpl_1",
    object: "chat.completion",
    created: 123,
    model: "gpt-test",
    choices: [{
      index: 0,
      message: { role: "assistant", content: "Hello" },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  }, { includeUsageChunk: false }));

  assertEquals(
    frames.some((frame) =>
      frame.type === "event" && frame.event.choices.length === 0
    ),
    false,
  );
});

Deno.test("chatCompletionResultToEvents preserves reasoning_items from terminal JSON", () => {
  const frames = Array.from(chatCompletionResultToEvents({
    id: "chatcmpl_reasoning_items",
    object: "chat.completion",
    created: 1,
    model: "gpt-test",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: "answer",
        reasoning_items: [{
          type: "reasoning",
          id: "rs_1",
          summary: [{ type: "summary_text", text: "trace" }],
          encrypted_content: "enc_1",
        }],
      },
      finish_reason: "stop",
    }],
  }));

  const reasoningItemsFrame = frames.find((frame) =>
    frame.type === "event" &&
    frame.event.choices[0]?.delta.reasoning_items !== undefined
  );

  assertEquals(
    reasoningItemsFrame?.type === "event"
      ? reasoningItemsFrame.event.choices[0]?.delta.reasoning_items
      : undefined,
    [{
      type: "reasoning",
      id: "rs_1",
      summary: [{ type: "summary_text", text: "trace" }],
      encrypted_content: "enc_1",
    }],
  );
});
