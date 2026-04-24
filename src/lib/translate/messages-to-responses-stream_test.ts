import { assertEquals } from "@std/assert";
import {
  createMessagesToResponsesStreamState,
  translateMessagesEventToResponsesEvents,
} from "./messages-to-responses-stream.ts";
import type { MessagesStreamEventData } from "../messages-types.ts";
import type { ResponsesResult } from "../responses-types.ts";

// ── Helpers ──

function runToCompletion(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}): ResponsesResult {
  const state = createMessagesToResponsesStreamState(
    "resp_test",
    "claude-sonnet-4-20250514",
  );

  translateMessagesEventToResponsesEvents({
    type: "message_start",
    message: {
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: [],
      model: "claude-sonnet-4-20250514",
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: 0,
        cache_read_input_tokens: usage.cache_read_input_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens,
      },
    },
  } as MessagesStreamEventData, state);

  translateMessagesEventToResponsesEvents(
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    } as MessagesStreamEventData,
    state,
  );
  translateMessagesEventToResponsesEvents(
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Hello" },
    } as MessagesStreamEventData,
    state,
  );
  translateMessagesEventToResponsesEvents(
    { type: "content_block_stop", index: 0 } as MessagesStreamEventData,
    state,
  );
  translateMessagesEventToResponsesEvents(
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: usage.output_tokens },
    } as MessagesStreamEventData,
    state,
  );

  const stopEvents = translateMessagesEventToResponsesEvents(
    { type: "message_stop" } as MessagesStreamEventData,
    state,
  );

  const completed = stopEvents.find((e) => e.type === "response.completed");
  if (!completed || completed.type !== "response.completed") {
    throw new Error("Expected response.completed event");
  }
  return (completed as {
    type: "response.completed";
    response: ResponsesResult;
  }).response;
}

// ── cache_creation_input_tokens ──

Deno.test("includes cache_creation_input_tokens in input_tokens", () => {
  const result = runToCompletion({
    input_tokens: 100,
    output_tokens: 50,
    cache_read_input_tokens: 20,
    cache_creation_input_tokens: 30,
  });

  assertEquals(result.usage!.input_tokens, 150); // 100 + 20 + 30
  assertEquals(result.usage!.output_tokens, 50);
  assertEquals(result.usage!.total_tokens, 200);
  assertEquals(result.usage!.input_tokens_details!.cached_tokens, 20);
});

Deno.test("handles cache_creation without cache_read", () => {
  const result = runToCompletion({
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 30,
  });

  assertEquals(result.usage!.input_tokens, 130); // 100 + 0 + 30
  assertEquals(result.usage!.total_tokens, 180);
  assertEquals(result.usage!.input_tokens_details, undefined);
});

Deno.test("handles no cache fields (backward compat)", () => {
  const result = runToCompletion({
    input_tokens: 100,
    output_tokens: 50,
  });

  assertEquals(result.usage!.input_tokens, 100);
  assertEquals(result.usage!.total_tokens, 150);
  assertEquals(result.usage!.input_tokens_details, undefined);
});
