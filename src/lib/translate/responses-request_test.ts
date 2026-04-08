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
