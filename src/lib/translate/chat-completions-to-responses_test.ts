import { assertEquals, assertThrows } from "@std/assert";
import {
  translateChatCompletionToResponsesResult,
  translateChatCompletionsToResponses,
} from "./chat-completions-to-responses.ts";
import type { ResponseInputReasoning } from "../responses-types.ts";

Deno.test("translateChatCompletionsToResponses uses rs-prefixed ids for reasoning input items", () => {
  const result = translateChatCompletionsToResponses({
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

Deno.test("translateChatCompletionsToResponses rejects tool messages without tool_call_id", () => {
  assertThrows(
    () =>
      translateChatCompletionsToResponses({
        model: "gpt-test",
        messages: [{ role: "tool", content: "result" }],
      }),
    Error,
    "tool_call_id",
  );
});

Deno.test("translateChatCompletionToResponsesResult maps reasoning text content tool calls and length finish reason", () => {
  const result = translateChatCompletionToResponsesResult({
    id: "chatcmpl_123",
    object: "chat.completion",
    created: 1,
    model: "gpt-test",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: "Hello",
        reasoning_text: "trace",
        reasoning_opaque: "enc_1",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "lookup", arguments: '{"q":"x"}' },
        }],
      },
      finish_reason: "length",
    }],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 4,
      total_tokens: 16,
      prompt_tokens_details: { cached_tokens: 3 },
    },
  });

  assertEquals(result.id, "chatcmpl_123");
  assertEquals(result.status, "incomplete");
  assertEquals(result.incomplete_details, { reason: "max_output_tokens" });
  assertEquals(result.output_text, "Hello");
  assertEquals(result.output, [
    {
      type: "reasoning",
      id: "rs_0",
      summary: [{ type: "summary_text", text: "trace" }],
      encrypted_content: "enc_1",
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Hello" }],
    },
    {
      type: "function_call",
      call_id: "call_1",
      name: "lookup",
      arguments: '{"q":"x"}',
      status: "completed",
    },
  ]);
  assertEquals(result.usage, {
    input_tokens: 12,
    output_tokens: 4,
    total_tokens: 16,
    input_tokens_details: { cached_tokens: 3 },
  });
});
