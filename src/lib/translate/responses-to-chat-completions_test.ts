import { assertEquals } from "@std/assert";
import { translateResponsesToChatCompletions } from "./responses-to-chat-completions.ts";

Deno.test("translateResponsesToChatCompletions merges adjacent assistant reasoning text and tool calls", () => {
  const result = translateResponsesToChatCompletions({
    model: "gpt-test",
    input: [
      { type: "message", role: "user", content: "Hi" },
      {
        type: "reasoning",
        id: "rs_1",
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
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "42",
      },
    ],
    instructions: "system prompt",
    temperature: 0.7,
    top_p: 0.8,
    max_output_tokens: 256,
    tools: null,
    tool_choice: "auto",
    metadata: { user_id: "user_123" },
    stream: false,
    store: false,
    parallel_tool_calls: true,
  });

  assertEquals(result.model, "gpt-test");
  assertEquals(result.user, "user_123");
  assertEquals(result.max_tokens, 256);
  assertEquals(result.messages, [
    { role: "system", content: "system prompt" },
    { role: "user", content: "Hi" },
    {
      role: "assistant",
      content: "Hello",
      reasoning_text: "trace",
      reasoning_opaque: "enc_1",
      tool_calls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "lookup",
          arguments: '{"q":"x"}',
        },
      }],
    },
    {
      role: "tool",
      tool_call_id: "call_1",
      content: "42",
    },
  ]);
});
