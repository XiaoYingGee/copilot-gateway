import { assertEquals, assertFalse } from "@std/assert";
import { translateResponsesToMessages } from "./responses-to-messages.ts";

Deno.test("translateResponsesToMessages maps reasoning.effort none to thinking.disabled", () => {
  const result = translateResponsesToMessages({
    model: "claude-test",
    input: [{ type: "message", role: "user", content: "hi" }],
    instructions: null,
    temperature: null,
    top_p: null,
    max_output_tokens: 256,
    tools: null,
    tool_choice: "auto",
    metadata: null,
    stream: null,
    store: false,
    parallel_tool_calls: true,
    reasoning: { effort: "none", summary: "detailed" },
  });

  assertEquals(result.thinking, { type: "disabled" });
  assertFalse("output_config" in result);
});

Deno.test("translateResponsesToMessages maps reasoning.effort directly to output_config.effort", () => {
  const result = translateResponsesToMessages({
    model: "claude-test",
    input: [{ type: "message", role: "user", content: "hi" }],
    instructions: null,
    temperature: null,
    top_p: null,
    max_output_tokens: 256,
    tools: null,
    tool_choice: "auto",
    metadata: null,
    stream: null,
    store: false,
    parallel_tool_calls: true,
    reasoning: { effort: "minimal", summary: "detailed" },
  });

  assertEquals(result.output_config, { effort: "minimal" });
  assertFalse("thinking" in result);
});

Deno.test("translateResponsesToMessages leaves max_tokens undefined when the source omitted max_output_tokens", () => {
  const result = translateResponsesToMessages({
    model: "claude-test",
    input: [{ type: "message", role: "user", content: "hi" }],
    instructions: null,
    temperature: null,
    top_p: null,
    max_output_tokens: null,
    tools: null,
    tool_choice: "auto",
    metadata: null,
    stream: null,
    store: false,
    parallel_tool_calls: true,
  });

  assertEquals(result.max_tokens, undefined);
});

Deno.test("translateResponsesToMessages preserves reasoning.encrypted_content without encoding the reasoning id", () => {
  const result = translateResponsesToMessages({
    model: "claude-test",
    input: [{
      type: "reasoning",
      id: "rs_42",
      summary: [{ type: "summary_text", text: "trace" }],
      encrypted_content: "enc_abc",
    }],
    instructions: null,
    temperature: null,
    top_p: null,
    max_output_tokens: 256,
    tools: null,
    tool_choice: "auto",
    metadata: null,
    stream: null,
    store: false,
    parallel_tool_calls: true,
  });

  const assistant = result.messages[0];
  if (assistant.role !== "assistant" || !Array.isArray(assistant.content)) {
    throw new Error("expected assistant message with content blocks");
  }

  assertEquals(assistant.content[0], {
    type: "thinking",
    thinking: "trace",
    signature: "enc_abc",
  });
});
