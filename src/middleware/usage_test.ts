import { assertEquals, assertExists } from "@std/assert";
import {
  copilotModels,
  flushAsyncWork,
  jsonResponse,
  requestApp,
  setupAppTest,
  sseResponse,
  withMockedFetch,
} from "../test-helpers.ts";

Deno.test("usage middleware records non-streaming usage and updates lastUsedAt", async () => {
  const { repo, apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({ token: "copilot-access-token", expires_at: 4102444800, refresh_in: 3600 });
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        { id: "claude-native", supported_endpoints: ["/v1/messages"] },
      ]));
    }
    if (url.pathname === "/v1/messages") {
      return jsonResponse({
        id: "msg_usage",
        type: "message",
        role: "assistant",
        model: "claude-native",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 7, output_tokens: 9 },
      });
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const response = await requestApp("/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
      },
      body: JSON.stringify({
        model: "claude-native",
        max_tokens: 64,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 200);
    await response.json();
  });

  await flushAsyncWork();

  const usage = await repo.usage.listAll();
  assertEquals(usage.length, 1);
  assertEquals(usage[0].keyId, apiKey.id);
  assertEquals(usage[0].model, "claude-native");
  assertEquals(usage[0].requests, 1);
  assertEquals(usage[0].inputTokens, 7);
  assertEquals(usage[0].outputTokens, 9);

  const updatedKey = await repo.apiKeys.getById(apiKey.id);
  assertExists(updatedKey?.lastUsedAt);
});

Deno.test("usage middleware records streaming usage from Responses SSE", async () => {
  const { repo, apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
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
      return sseResponse([
        {
          event: "response.completed",
          data: {
            type: "response.completed",
            response: {
              id: "resp_usage",
              object: "response",
              model: "gpt-direct-responses",
              status: "completed",
              output: [],
              output_text: "",
              usage: { input_tokens: 11, output_tokens: 13, total_tokens: 24 },
            },
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
        input: [{ type: "message", role: "user", content: "Hi" }],
        instructions: null,
        temperature: 1,
        top_p: null,
        max_output_tokens: 32,
        tools: null,
        tool_choice: "auto",
        metadata: null,
        stream: true,
        store: false,
        parallel_tool_calls: true,
      }),
    });

    assertEquals(response.status, 200);
    await response.text();
  });

  await flushAsyncWork();

  const usage = await repo.usage.listAll();
  assertEquals(usage.length, 1);
  assertEquals(usage[0].keyId, apiKey.id);
  assertEquals(usage[0].model, "gpt-direct-responses");
  assertEquals(usage[0].inputTokens, 11);
  assertEquals(usage[0].outputTokens, 13);

  const updatedKey = await repo.apiKeys.getById(apiKey.id);
  assertExists(updatedKey?.lastUsedAt);
});
