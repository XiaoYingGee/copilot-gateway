import { assertEquals } from "@std/assert";
import { translateMessagesToChatCompletions } from "./messages-to-chat-completions.ts";

Deno.test("translateMessagesToChatCompletions keeps tool_result and user text as separate chat messages", () => {
  const result = translateMessagesToChatCompletions({
    model: "gpt-test",
    max_tokens: 256,
    messages: [{
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_1", content: "result" },
        { type: "text", text: "Please continue." },
      ],
    }],
  });

  assertEquals(result.messages, [
    { role: "tool", tool_call_id: "toolu_1", content: "result" },
    { role: "user", content: "Please continue." },
  ]);
});

Deno.test("translateMessagesToChatCompletions drops filtered-native tool_choice and rewrites assistant native web-search history as tool-call history", () => {
  const result = translateMessagesToChatCompletions({
    model: "gpt-test",
    max_tokens: 256,
    tool_choice: { type: "any" },
    tools: [{ type: "web_search_20260209", name: "NativeSearch" }],
    messages: [{
      role: "assistant",
      content: [
        {
          type: "server_tool_use",
          id: "st_1",
          name: "web_search",
          input: { query: "React docs" },
        },
        {
          type: "web_search_tool_result",
          tool_use_id: "st_1",
          content: [{
            type: "web_search_result",
            url: "https://react.dev",
            title: "React",
            encrypted_content: "cgws1.payload",
          }],
        },
      ],
    }],
  });

  assertEquals(result.tools, undefined);
  assertEquals(result.tool_choice, undefined);
  assertEquals(result.messages, [
    {
      role: "assistant",
      content: null,
      tool_calls: [{
        id: "st_1",
        type: "function",
        function: {
          name: "web_search",
          arguments: '{"query":"React docs"}',
        },
      }],
    },
    {
      role: "tool",
      tool_call_id: "st_1",
      content:
        '[{"type":"web_search_result","url":"https://react.dev","title":"React","encrypted_content":"cgws1.payload"}]',
    },
  ]);
});

Deno.test("translateMessagesToChatCompletions flattens text-block tool_result content but serializes search-result arrays", () => {
  const result = translateMessagesToChatCompletions({
    model: "gpt-test",
    max_tokens: 256,
    messages: [{
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_text",
          content: [{ type: "text", text: "hello" }],
        },
        {
          type: "tool_result",
          tool_use_id: "toolu_search",
          content: [{
            type: "search_result",
            source: "https://react.dev",
            title: "React",
            content: [{ type: "text", text: "Official docs" }],
          }],
        },
      ],
    }],
  });

  assertEquals(result.messages, [
    { role: "tool", tool_call_id: "toolu_text", content: "hello" },
    {
      role: "tool",
      tool_call_id: "toolu_search",
      content:
        '[{"type":"search_result","source":"https://react.dev","title":"React","content":[{"type":"text","text":"Official docs"}]}]',
    },
  ]);
});

Deno.test("translateMessagesToChatCompletions keeps the first thinking signature when folding multiple thinking blocks", () => {
  const result = translateMessagesToChatCompletions({
    model: "gpt-test",
    max_tokens: 256,
    messages: [{
      role: "assistant",
      content: [
        { type: "thinking", thinking: "first", signature: "sig1" },
        { type: "text", text: "middle" },
        { type: "thinking", thinking: "second", signature: "sig2" },
      ],
    }],
  });

  assertEquals(result.messages, [{
    role: "assistant",
    content: "middle",
    reasoning_text: "first\n\nsecond",
    reasoning_opaque: "sig1",
  }]);
});
