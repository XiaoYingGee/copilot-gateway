import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import {
  copilotModels,
  jsonResponse,
  parseSSEText,
  requestApp,
  setupAppTest,
  sseResponse,
  withMockedFetch,
} from "../test-helpers.ts";

Deno.test("/v1/responses direct mode converts apply_patch and fixes mismatched stream item IDs", async () => {
  const { apiKey } = await setupAppTest();

  let upstreamBody: Record<string, unknown> | undefined;

  await withMockedFetch(async (request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({ token: "copilot-access-token", expires_at: 4102444800, refresh_in: 3600 });
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        { id: "gpt-direct-responses", supported_endpoints: ["/responses"] },
      ]));
    }
    if (url.pathname === "/responses") {
      upstreamBody = JSON.parse(await request.text());
      return sseResponse([
        {
          event: "response.output_item.added",
          data: {
            type: "response.output_item.added",
            output_index: 0,
            item: { id: "item_orig", type: "message", role: "assistant", content: [{ type: "output_text", text: "" }] },
          },
        },
        {
          event: "response.output_item.done",
          data: {
            type: "response.output_item.done",
            output_index: 0,
            item: { id: "item_wrong", type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] },
          },
        },
      ]);
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const response = await requestApp("/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
      },
      body: JSON.stringify({
        model: "gpt-direct-responses",
        input: [{ type: "message", role: "user", content: "Patch this" }],
        instructions: null,
        temperature: 1,
        top_p: null,
        max_output_tokens: 32,
        tools: [{ type: "custom", name: "apply_patch" }],
        tool_choice: "auto",
        metadata: null,
        stream: true,
        store: false,
        parallel_tool_calls: true,
      }),
    });

    assertEquals(response.status, 200);
    const text = await response.text();
    const events = parseSSEText(text);
    assertEquals(events.length, 2);
    assertStringIncludes(events[1].data, '"id":"item_orig"');
  });

  assertExists(upstreamBody);
  const tool = (upstreamBody!.tools as Array<Record<string, unknown>>)[0];
  assertEquals(tool.type, "function");
  assertEquals(tool.name, "apply_patch");
  assertEquals((tool.parameters as Record<string, unknown>).type, "object");
});

Deno.test("/v1/responses via messages translates Anthropic SSE into Responses SSE", async () => {
  const { apiKey } = await setupAppTest();

  let upstreamBody: Record<string, unknown> | undefined;

  await withMockedFetch(async (request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({ token: "copilot-access-token", expires_at: 4102444800, refresh_in: 3600 });
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        { id: "claude-via-messages", supported_endpoints: ["/v1/messages"] },
      ]));
    }
    if (url.pathname === "/v1/messages") {
      upstreamBody = JSON.parse(await request.text());
      return sseResponse([
        {
          event: "message_start",
          data: {
            type: "message_start",
            message: {
              id: "msg_123",
              type: "message",
              role: "assistant",
              content: [],
              model: "claude-via-messages",
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 11, output_tokens: 0 },
            },
          },
        },
        {
          event: "content_block_start",
          data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        },
        {
          event: "content_block_delta",
          data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
        },
        { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
        {
          event: "message_delta",
          data: {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 9 },
          },
        },
        { event: "message_stop", data: { type: "message_stop" } },
      ]);
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const response = await requestApp("/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
      },
      body: JSON.stringify({
        model: "claude-via-messages",
        input: [{ type: "message", role: "user", content: "Hi" }],
        instructions: null,
        temperature: 1,
        top_p: null,
        max_output_tokens: 32,
        tools: [{ type: "custom", name: "apply_patch" }],
        tool_choice: "auto",
        metadata: null,
        stream: true,
        store: false,
        parallel_tool_calls: true,
      }),
    });

    assertEquals(response.status, 200);
    const text = await response.text();
    const events = parseSSEText(text);

    assertEquals(events[0].event, "response.created");
    assertEquals(events[1].event, "response.in_progress");
    assertEquals(events[4].event, "response.output_text.delta");
    assertEquals(events[events.length - 1].event, "response.completed");

    const first = JSON.parse(events[0].data) as Record<string, unknown>;
    const delta = JSON.parse(events[4].data) as Record<string, unknown>;
    const completed = JSON.parse(events[events.length - 1].data) as Record<string, unknown>;

    assertEquals(first.sequence_number, 0);
    assertEquals(delta.sequence_number, 4);
    assertEquals((completed.response as Record<string, unknown>).status, "completed");
    assertEquals((((completed.response as Record<string, unknown>).usage as Record<string, unknown>).output_tokens), 9);
  });

  assertExists(upstreamBody);
  assertEquals((upstreamBody!.tools as Array<Record<string, unknown>>)[0].name, "apply_patch");
  assertEquals(upstreamBody!.stream, true);
});
