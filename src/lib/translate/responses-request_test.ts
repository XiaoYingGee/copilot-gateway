import { assertEquals } from "@std/assert";
import { translateChatToResponses } from "./chat-to-responses.ts";
import {
  translateAnthropicToResponses,
  translateAnthropicToResponsesResult,
} from "./responses.ts";
import type {
  ResponseInputReasoning,
  ResponseOutputReasoning,
} from "../responses-types.ts";

Deno.test("translateAnthropicToResponses uses rs-prefixed ids for reasoning input items", () => {
  const result = translateAnthropicToResponses({
    model: "gpt-test",
    max_tokens: 256,
    messages: [{
      role: "assistant",
      content: [{ type: "thinking", thinking: "trace", signature: "sig" }],
    }],
  });

  if (!Array.isArray(result.input)) throw new Error("expected input array");
  const reasoning = result.input[0] as ResponseInputReasoning;
  assertEquals(reasoning.type, "reasoning");
  assertEquals(reasoning.id, "rs_0");
});

Deno.test("translateChatToResponses uses rs-prefixed ids for reasoning input items", () => {
  const result = translateChatToResponses({
    model: "gpt-test",
    messages: [{
      role: "assistant",
      content: "answer",
      reasoning_text: "trace",
      reasoning_opaque: "enc",
    }],
  });

  if (!Array.isArray(result.input)) throw new Error("expected input array");
  const reasoning = result.input[0] as ResponseInputReasoning;
  assertEquals(reasoning.type, "reasoning");
  assertEquals(reasoning.id, "rs_0");
});

Deno.test("translateAnthropicToResponsesResult uses rs-prefixed ids for reasoning output items", () => {
  const result = translateAnthropicToResponsesResult({
    id: "msg_123",
    type: "message",
    role: "assistant",
    model: "claude-test",
    content: [{ type: "thinking", thinking: "trace", signature: "sig" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 3 },
  });

  const reasoning = result.output[0] as ResponseOutputReasoning;
  assertEquals(reasoning.type, "reasoning");
  assertEquals(reasoning.id, "rs_0");
});

Deno.test("translateAnthropicToResponsesResult includes cache_creation_input_tokens in input_tokens", () => {
  const result = translateAnthropicToResponsesResult({
    id: "msg_123",
    type: "message",
    role: "assistant",
    model: "claude-test",
    content: [{ type: "text", text: "Hello" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 30 },
  });

  assertEquals(result.usage!.input_tokens, 150); // 100 + 20 + 30
  assertEquals(result.usage!.output_tokens, 50);
  assertEquals(result.usage!.total_tokens, 200);
  assertEquals(result.usage!.input_tokens_details!.cached_tokens, 20);
});

Deno.test("translateAnthropicToResponsesResult handles cache_creation without cache_read", () => {
  const result = translateAnthropicToResponsesResult({
    id: "msg_123",
    type: "message",
    role: "assistant",
    model: "claude-test",
    content: [{ type: "text", text: "Hello" }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 30 },
  });

  assertEquals(result.usage!.input_tokens, 130); // 100 + 0 + 30
  assertEquals(result.usage!.total_tokens, 180);
  assertEquals(result.usage!.input_tokens_details, undefined);
});
