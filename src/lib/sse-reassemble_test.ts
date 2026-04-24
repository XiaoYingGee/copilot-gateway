import { assertEquals, assertRejects } from "@std/assert";
import {
  reassembleChatCompletionsSSE,
  reassembleMessagesSSE,
  reassembleResponsesSSE,
} from "./sse-reassemble.ts";
import type { MessagesResponse } from "./messages-types.ts";
import type { ChatCompletionResponse } from "./chat-completions-types.ts";
import type { ResponsesResult } from "./responses-types.ts";

function makeSSEBody(
  chunks: Array<{ event?: string; data: unknown }>,
): ReadableStream<Uint8Array> {
  const text = chunks.map((c) => {
    const lines: string[] = [];
    if (c.event) lines.push(`event: ${c.event}`);
    const data = typeof c.data === "string" ? c.data : JSON.stringify(c.data);
    lines.push(`data: ${data}`);
    return lines.join("\n");
  }).join("\n\n") + "\n\n";

  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

// ── reassembleMessagesSSE ──

Deno.test("reassembleMessagesSSE reassembles text response", async () => {
  const body = makeSSEBody([
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-test",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
    },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello " },
      },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "world" },
      },
    },
    {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: 0 },
    },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 5 },
      },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ]);

  const result: MessagesResponse = await reassembleMessagesSSE(body);

  assertEquals(result.id, "msg_1");
  assertEquals(result.model, "claude-test");
  assertEquals(result.stop_reason, "end_turn");
  assertEquals(result.content.length, 1);
  assertEquals(result.content[0].type, "text");
  assertEquals(
    (result.content[0] as { type: "text"; text: string }).text,
    "Hello world",
  );
  assertEquals(result.usage.input_tokens, 10);
  assertEquals(result.usage.output_tokens, 5);
});

Deno.test("reassembleMessagesSSE reassembles tool_use response", async () => {
  const body = makeSSEBody([
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_2",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-test",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 20, output_tokens: 0 },
        },
      },
    },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "tu_1", name: "calc" },
      },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"x":' },
      },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: "42}" },
      },
    },
    {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: 0 },
    },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 10 },
      },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ]);

  const result = await reassembleMessagesSSE(body);

  assertEquals(result.stop_reason, "tool_use");
  assertEquals(result.content.length, 1);
  assertEquals(result.content[0].type, "tool_use");
  const tu = result.content[0] as {
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;
  };
  assertEquals(tu.id, "tu_1");
  assertEquals(tu.name, "calc");
  assertEquals(tu.input, { x: 42 });
});

Deno.test("reassembleMessagesSSE reassembles thinking blocks", async () => {
  const body = makeSSEBody([
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_3",
          type: "message",
          role: "assistant",
          content: [],
          model: "claude-test",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 0 },
        },
      },
    },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "let me think" },
      },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "sig_123" },
      },
    },
    {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: 0 },
    },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" },
      },
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "answer" },
      },
    },
    {
      event: "content_block_stop",
      data: { type: "content_block_stop", index: 1 },
    },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 20 },
      },
    },
    { event: "message_stop", data: { type: "message_stop" } },
  ]);

  const result = await reassembleMessagesSSE(body);

  assertEquals(result.content.length, 2);
  assertEquals(result.content[0].type, "thinking");
  const thinking = result.content[0] as {
    type: "thinking";
    thinking: string;
    signature?: string;
  };
  assertEquals(thinking.thinking, "let me think");
  assertEquals(thinking.signature, "sig_123");
  assertEquals(result.content[1].type, "text");
});

Deno.test("reassembleMessagesSSE throws on error event", async () => {
  const body = makeSSEBody([
    {
      event: "error",
      data: {
        type: "error",
        error: { type: "overloaded_error", message: "overloaded" },
      },
    },
  ]);

  await assertRejects(
    () => reassembleMessagesSSE(body),
    Error,
    "overloaded",
  );
});

// ── reassembleChatCompletionsSSE ──

Deno.test("reassembleChatCompletionsSSE reassembles text response", async () => {
  const body = makeSSEBody([
    {
      data: {
        id: "cmpl_1",
        object: "chat.completion.chunk",
        created: 1000,
        model: "gpt-test",
        choices: [{
          index: 0,
          delta: { role: "assistant", content: "Hello" },
          finish_reason: null,
        }],
      },
    },
    {
      data: {
        id: "cmpl_1",
        object: "chat.completion.chunk",
        created: 1000,
        model: "gpt-test",
        choices: [{
          index: 0,
          delta: { content: " world" },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    },
    { data: "[DONE]" },
  ]);

  const result: ChatCompletionResponse = await reassembleChatCompletionsSSE(
    body,
  );

  assertEquals(result.id, "cmpl_1");
  assertEquals(result.model, "gpt-test");
  assertEquals(result.created, 1000);
  assertEquals(result.object, "chat.completion");
  assertEquals(result.choices.length, 1);
  assertEquals(result.choices[0].index, 0);
  assertEquals(result.choices[0].message.content, "Hello world");
  assertEquals(result.choices[0].finish_reason, "stop");
  assertEquals(result.usage?.prompt_tokens, 10);
});

Deno.test("reassembleChatCompletionsSSE reassembles tool calls", async () => {
  const body = makeSSEBody([
    {
      data: {
        id: "cmpl_2",
        object: "chat.completion.chunk",
        created: 2000,
        model: "gpt-test",
        choices: [{
          index: 0,
          delta: {
            role: "assistant",
            content: "",
            tool_calls: [{
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "lookup", arguments: '{"city"' },
            }],
          },
          finish_reason: null,
        }],
      },
    },
    {
      data: {
        id: "cmpl_2",
        object: "chat.completion.chunk",
        created: 2000,
        model: "gpt-test",
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: ':"Tokyo"}' },
            }],
          },
          finish_reason: "tool_calls",
        }],
      },
    },
    { data: "[DONE]" },
  ]);

  const result = await reassembleChatCompletionsSSE(body);

  assertEquals(result.choices[0].finish_reason, "tool_calls");
  assertEquals(result.choices[0].message.tool_calls?.length, 1);
  assertEquals(result.choices[0].message.tool_calls![0].id, "call_1");
  assertEquals(
    result.choices[0].message.tool_calls![0].function.name,
    "lookup",
  );
  assertEquals(
    result.choices[0].message.tool_calls![0].function.arguments,
    '{"city":"Tokyo"}',
  );
});

Deno.test("reassembleChatCompletionsSSE reassembles reasoning fields", async () => {
  const body = makeSSEBody([
    {
      data: {
        id: "cmpl_3",
        object: "chat.completion.chunk",
        created: 3000,
        model: "gpt-test",
        choices: [{
          index: 0,
          delta: {
            role: "assistant",
            reasoning_text: "think",
            reasoning_opaque: "enc",
          },
          finish_reason: null,
        }],
      },
    },
    {
      data: {
        id: "cmpl_3",
        object: "chat.completion.chunk",
        created: 3000,
        model: "gpt-test",
        choices: [{
          index: 0,
          delta: { content: "reply" },
          finish_reason: "stop",
        }],
      },
    },
    { data: "[DONE]" },
  ]);

  const result = await reassembleChatCompletionsSSE(body);

  assertEquals(result.choices[0].message.reasoning_text, "think");
  assertEquals(result.choices[0].message.reasoning_opaque, "enc");
  assertEquals(result.choices[0].message.content, "reply");
});

// ── reassembleResponsesSSE ──

Deno.test("reassembleResponsesSSE extracts response from completed event", async () => {
  const expected: ResponsesResult = {
    id: "resp_1",
    object: "response",
    model: "gpt-test",
    status: "completed",
    output_text: "Hello",
    output: [{
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Hello" }],
    }],
    usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 },
  };

  const body = makeSSEBody([
    {
      event: "response.created",
      data: {
        type: "response.created",
        response: { ...expected, status: "in_progress" },
      },
    },
    {
      event: "response.in_progress",
      data: {
        type: "response.in_progress",
        response: { ...expected, status: "in_progress" },
      },
    },
    {
      event: "response.output_text.delta",
      data: { type: "response.output_text.delta", delta: "Hello" },
    },
    {
      event: "response.completed",
      data: { type: "response.completed", response: expected },
    },
  ]);

  const result = await reassembleResponsesSSE(body);

  assertEquals(result.id, "resp_1");
  assertEquals(result.status, "completed");
  assertEquals(result.output_text, "Hello");
});

Deno.test("reassembleResponsesSSE handles incomplete event", async () => {
  const incomplete: ResponsesResult = {
    id: "resp_2",
    object: "response",
    model: "gpt-test",
    status: "incomplete",
    output_text: "",
    output: [],
    incomplete_details: { reason: "max_tokens" },
  };

  const body = makeSSEBody([
    {
      event: "response.incomplete",
      data: { type: "response.incomplete", response: incomplete },
    },
  ]);

  const result = await reassembleResponsesSSE(body);
  assertEquals(result.status, "incomplete");
});

Deno.test("reassembleResponsesSSE throws on error event", async () => {
  const body = makeSSEBody([
    { event: "error", data: { type: "error", message: "bad request" } },
  ]);

  await assertRejects(
    () => reassembleResponsesSSE(body),
    Error,
    "bad request",
  );
});

Deno.test("reassembleResponsesSSE throws when stream ends without terminal event", async () => {
  const body = makeSSEBody([
    {
      event: "response.created",
      data: { type: "response.created", response: {} },
    },
  ]);

  await assertRejects(
    () => reassembleResponsesSSE(body),
    Error,
    "terminal",
  );
});
