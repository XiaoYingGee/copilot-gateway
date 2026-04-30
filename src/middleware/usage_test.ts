import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { Hono } from "hono";
import {
  copilotModels,
  flushAsyncWork,
  jsonResponse,
  parseSSEText,
  requestApp,
  setupAppTest,
  sseResponse,
  withMockedFetch,
} from "../test-helpers.ts";
import { usageMiddleware } from "./usage.ts";

const requestUsageMiddlewareOnly = async (
  keyId: string,
  response: Response,
): Promise<Response> => {
  const app = new Hono<{ Variables: { apiKeyId: string } }>();
  app.use("*", async (c, next) => {
    c.set("apiKeyId", keyId);
    await next();
  });
  app.use("*", usageMiddleware);
  app.post("/v1/messages", () => response);

  return await app.request("/v1/messages", { method: "POST" });
};

Deno.test("usage middleware records non-streaming usage and updates lastUsedAt", async () => {
  const { repo, apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
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
        usage: {
          input_tokens: 7,
          output_tokens: 9,
          cache_read_input_tokens: 3,
          cache_creation_input_tokens: 5,
        },
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
  assertEquals(usage[0].inputTokens, 15);
  assertEquals(usage[0].outputTokens, 9);
  assertEquals(usage[0].cacheReadTokens, 3);
  assertEquals(usage[0].cacheCreationTokens, 5);

  const updatedKey = await repo.apiKeys.getById(apiKey.id);
  assertExists(updatedKey?.lastUsedAt);
});

Deno.test("usage middleware records resolved model after dated Claude alias fallback", async () => {
  const { repo, apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        { id: "claude-haiku-4.5", supported_endpoints: ["/v1/messages"] },
      ]));
    }
    if (url.pathname === "/v1/messages") {
      return jsonResponse({
        id: "msg_alias_usage",
        type: "message",
        role: "assistant",
        model: "claude-haiku-4.5",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 7, output_tokens: 3 },
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
        model: "claude-haiku-4-5-20251001",
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
  assertEquals(usage[0].model, "claude-haiku-4.5");
});

Deno.test("usage middleware records resolved model instead of upstream response model", async () => {
  const { repo, apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        { id: "gpt-5.5", supported_endpoints: ["/responses"] },
      ]));
    }
    if (url.pathname === "/responses") {
      return jsonResponse({
        id: "resp_internal_version_usage",
        object: "response",
        model: "gpt-5.5-2026-04-23",
        status: "completed",
        output: [],
        output_text: "ok",
        usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 },
      });
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
        model: "gpt-5.5",
        input: "Hi",
      }),
    });

    assertEquals(response.status, 200);
    await response.json();
  });

  await flushAsyncWork();

  const usage = await repo.usage.listAll();
  assertEquals(usage.length, 1);
  assertEquals(usage[0].model, "gpt-5.5");
});

Deno.test("usage middleware records non-LLM response model without route context", async () => {
  const { repo, apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        { id: "text-embedding-real", supported_endpoints: ["/embeddings"] },
      ]));
    }
    if (url.pathname === "/embeddings") {
      return jsonResponse({
        object: "list",
        model: "text-embedding-real",
        data: [{ object: "embedding", index: 0, embedding: [0.1] }],
        usage: { prompt_tokens: 5, total_tokens: 5 },
      });
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const response = await requestApp("/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
      },
      body: JSON.stringify({
        model: "text-embedding-real",
        input: "hello",
      }),
    });

    assertEquals(response.status, 200);
    await response.json();
  });

  await flushAsyncWork();

  const usage = await repo.usage.listAll();
  assertEquals(usage.length, 1);
  assertEquals(usage[0].model, "text-embedding-real");
});

Deno.test("usage middleware records resolved model when non-streaming LLM response omits model", async () => {
  const { repo, apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        { id: "claude-native", supported_endpoints: ["/v1/messages"] },
      ]));
    }
    if (url.pathname === "/v1/messages") {
      return jsonResponse({
        id: "msg_missing_model_usage",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 7, output_tokens: 3 },
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

  const usage = await repo.usage.listAll();
  assertEquals(usage.length, 1);
  assertEquals(usage[0].model, "claude-native");
});

Deno.test("usage middleware rejects non-streaming usage without any model signal", async () => {
  const { repo, apiKey } = await setupAppTest();

  const response = await requestUsageMiddlewareOnly(
    apiKey.id,
    Response.json({
      id: "msg_missing_model_usage",
      usage: { input_tokens: 7, output_tokens: 3 },
    }),
  );

  assertEquals(response.status, 500);
  assertEquals(await repo.usage.listAll(), []);
});

Deno.test("usage middleware records resolved model when streaming LLM response omits model", async () => {
  const { repo, apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
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
              id: "resp_missing_model_usage",
              object: "response",
              status: "completed",
              output: [],
              output_text: "",
              usage: {
                input_tokens: 11,
                output_tokens: 13,
                total_tokens: 24,
              },
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
        input: "Hi",
        stream: true,
      }),
    });

    assertEquals(response.status, 200);
    await response.text();
  });

  await flushAsyncWork();
  const usage = await repo.usage.listAll();
  assertEquals(usage.length, 1);
  assertEquals(usage[0].model, "gpt-direct-responses");
});

Deno.test("usage middleware rejects streaming usage without any model signal", async () => {
  const { repo, apiKey } = await setupAppTest();

  const response = await requestUsageMiddlewareOnly(
    apiKey.id,
    new Response(
      'data: {"usage":{"prompt_tokens":7,"completion_tokens":3}}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    ),
  );

  assertEquals(response.status, 200);
  await assertRejects(
    () => response.text(),
    Error,
    "Usage response has token usage but no model",
  );
  assertEquals(await repo.usage.listAll(), []);
});

Deno.test("usage middleware rejects when usage persistence fails", async () => {
  const { repo, apiKey } = await setupAppTest();
  repo.usage.record = (() =>
    Promise.reject(
      new Error("usage write failed"),
    )) as typeof repo.usage.record;

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        { id: "claude-native", supported_endpoints: ["/v1/messages"] },
      ]));
    }
    if (url.pathname === "/v1/messages") {
      return jsonResponse({
        id: "msg_usage_write_failure",
        type: "message",
        role: "assistant",
        model: "claude-native",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 7, output_tokens: 3 },
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

    assertEquals(response.status, 500);
  });
});

Deno.test("usage middleware rejects non-streaming invalid JSON instead of skipping accounting", async () => {
  const { repo, apiKey } = await setupAppTest();

  const response = await requestUsageMiddlewareOnly(
    apiKey.id,
    new Response("not-json", {
      headers: { "content-type": "application/json" },
    }),
  );

  assertEquals(response.status, 500);
  assertEquals(await repo.usage.listAll(), []);
});

Deno.test("usage middleware rejects streaming invalid JSON instead of skipping accounting", async () => {
  const { repo, apiKey } = await setupAppTest();

  const response = await requestUsageMiddlewareOnly(
    apiKey.id,
    new Response("data: {bad-json}\n\n", {
      headers: { "content-type": "text/event-stream" },
    }),
  );

  assertEquals(response.status, 200);
  await assertRejects(() => response.text(), SyntaxError);
  assertEquals(await repo.usage.listAll(), []);
});

Deno.test("usage middleware records streaming Responses usage under resolved model", async () => {
  const { repo, apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        { id: "gpt-5.5", supported_endpoints: ["/responses"] },
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
              model: "gpt-5.5-2026-04-23",
              status: "completed",
              output: [],
              output_text: "",
              usage: {
                input_tokens: 11,
                output_tokens: 13,
                total_tokens: 24,
                input_tokens_details: { cached_tokens: 4 },
              },
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
        model: "gpt-5.5",
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
  assertEquals(usage[0].model, "gpt-5.5");
  assertEquals(usage[0].inputTokens, 11);
  assertEquals(usage[0].outputTokens, 13);
  assertEquals(usage[0].cacheReadTokens, 4);
  assertEquals(usage[0].cacheCreationTokens, 0);

  const updatedKey = await repo.apiKeys.getById(apiKey.id);
  assertExists(updatedKey?.lastUsedAt);
});

Deno.test("usage middleware records streaming usage from incomplete Responses SSE", async () => {
  const { repo, apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        { id: "gpt-incomplete-responses", supported_endpoints: ["/responses"] },
      ]));
    }
    if (url.pathname === "/responses") {
      return sseResponse([
        {
          event: "response.incomplete",
          data: {
            type: "response.incomplete",
            response: {
              id: "resp_usage_incomplete",
              object: "response",
              model: "gpt-incomplete-responses",
              status: "incomplete",
              incomplete_details: { reason: "max_output_tokens" },
              output: [],
              output_text: "",
              usage: {
                input_tokens: 17,
                output_tokens: 19,
                total_tokens: 36,
                input_tokens_details: { cached_tokens: 5 },
              },
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
        model: "gpt-incomplete-responses",
        input: "Hi",
        stream: true,
      }),
    });

    assertEquals(response.status, 200);
    await response.text();
  });

  await flushAsyncWork();

  const usage = await repo.usage.listAll();
  assertEquals(usage.length, 1);
  assertEquals(usage[0].keyId, apiKey.id);
  assertEquals(usage[0].model, "gpt-incomplete-responses");
  assertEquals(usage[0].requests, 1);
  assertEquals(usage[0].inputTokens, 17);
  assertEquals(usage[0].outputTokens, 19);
  assertEquals(usage[0].cacheReadTokens, 5);
  assertEquals(usage[0].cacheCreationTokens, 0);
});

Deno.test("usage middleware records hidden streaming usage from Chat Completions SSE", async () => {
  const { repo, apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        { id: "gpt-direct-chat", supported_endpoints: ["/chat/completions"] },
      ]));
    }
    if (url.pathname === "/chat/completions") {
      return sseResponse([
        {
          data: {
            id: "chatcmpl_usage_hidden",
            object: "chat.completion.chunk",
            created: 1,
            model: "gpt-direct-chat",
            choices: [{
              index: 0,
              delta: { role: "assistant" },
              finish_reason: null,
            }],
          },
        },
        {
          data: {
            id: "chatcmpl_usage_hidden",
            object: "chat.completion.chunk",
            created: 1,
            model: "gpt-direct-chat",
            choices: [{
              index: 0,
              delta: { content: "Hello" },
              finish_reason: null,
            }],
          },
        },
        {
          data: {
            id: "chatcmpl_usage_hidden",
            object: "chat.completion.chunk",
            created: 1,
            model: "gpt-direct-chat",
            choices: [{
              index: 0,
              delta: {},
              finish_reason: "stop",
            }],
          },
        },
        {
          data: {
            id: "chatcmpl_usage_hidden",
            object: "chat.completion.chunk",
            created: 1,
            model: "gpt-direct-chat",
            choices: [],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 4,
              total_tokens: 16,
            },
          },
        },
        { data: "[DONE]" },
      ]);
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const response = await requestApp("/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
      },
      body: JSON.stringify({
        model: "gpt-direct-chat",
        stream: true,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 200);

    const events = parseSSEText(await response.text());
    assertEquals(
      events.some((event) => {
        if (event.data === "[DONE]") return false;
        const data = JSON.parse(event.data) as Record<string, unknown>;
        return Array.isArray(data.choices) && data.choices.length === 0 &&
          "usage" in data;
      }),
      false,
    );
  });

  await flushAsyncWork();

  const usage = await repo.usage.listAll();
  assertEquals(usage.length, 1);
  assertEquals(usage[0].keyId, apiKey.id);
  assertEquals(usage[0].model, "gpt-direct-chat");
  assertEquals(usage[0].inputTokens, 12);
  assertEquals(usage[0].outputTokens, 4);
  assertEquals(usage[0].cacheReadTokens, 0);
  assertEquals(usage[0].cacheCreationTokens, 0);

  const updatedKey = await repo.apiKeys.getById(apiKey.id);
  assertExists(updatedKey?.lastUsedAt);
});

Deno.test("usage middleware records hidden streaming usage from Chat via Responses SSE", async () => {
  const { repo, apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        { id: "gpt-responses-chat", supported_endpoints: ["/responses"] },
      ]));
    }
    if (url.pathname === "/responses") {
      return sseResponse([
        {
          event: "response.created",
          data: {
            type: "response.created",
            response: {
              id: "resp_chat_usage_hidden",
              object: "response",
              model: "gpt-responses-chat",
              status: "in_progress",
              output: [],
              output_text: "",
            },
          },
        },
        {
          event: "response.output_text.delta",
          data: {
            type: "response.output_text.delta",
            item_id: "msg_0",
            output_index: 0,
            content_index: 0,
            delta: "Hello",
          },
        },
        {
          event: "response.completed",
          data: {
            type: "response.completed",
            response: {
              id: "resp_chat_usage_hidden",
              object: "response",
              model: "gpt-responses-chat",
              status: "completed",
              output: [],
              output_text: "Hello",
              usage: {
                input_tokens: 21,
                output_tokens: 5,
                total_tokens: 26,
                input_tokens_details: { cached_tokens: 7 },
              },
            },
          },
        },
      ]);
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const response = await requestApp("/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
      },
      body: JSON.stringify({
        model: "gpt-responses-chat",
        stream: true,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 200);

    const events = parseSSEText(await response.text());
    assertEquals(
      events.some((event) => {
        if (event.data === "[DONE]") return false;
        const data = JSON.parse(event.data) as Record<string, unknown>;
        return "usage" in data;
      }),
      false,
    );
  });

  await flushAsyncWork();

  const usage = await repo.usage.listAll();
  assertEquals(usage.length, 1);
  assertEquals(usage[0].keyId, apiKey.id);
  assertEquals(usage[0].model, "gpt-responses-chat");
  assertEquals(usage[0].inputTokens, 21);
  assertEquals(usage[0].outputTokens, 5);
  assertEquals(usage[0].cacheReadTokens, 7);
  assertEquals(usage[0].cacheCreationTokens, 0);

  const updatedKey = await repo.apiKeys.getById(apiKey.id);
  assertExists(updatedKey?.lastUsedAt);
});

Deno.test("usage middleware records hidden streaming usage from Chat via Messages SSE", async () => {
  const { repo, apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        {
          id: "claude-chat-usage-hidden",
          supported_endpoints: ["/v1/messages"],
        },
      ]));
    }
    if (url.pathname === "/v1/messages") {
      return sseResponse([
        {
          event: "message_start",
          data: {
            type: "message_start",
            message: {
              id: "msg_chat_usage_hidden",
              type: "message",
              role: "assistant",
              content: [],
              model: "claude-chat-usage-hidden",
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 14, output_tokens: 0 },
            },
          },
        },
        {
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "Hello" },
          },
        },
        {
          event: "message_delta",
          data: {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 6 },
          },
        },
        { event: "message_stop", data: { type: "message_stop" } },
      ]);
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const response = await requestApp("/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
      },
      body: JSON.stringify({
        model: "claude-chat-usage-hidden",
        stream: true,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 200);

    const events = parseSSEText(await response.text());
    assertEquals(
      events.some((event) => {
        if (event.data === "[DONE]") return false;
        const data = JSON.parse(event.data) as Record<string, unknown>;
        return "usage" in data;
      }),
      false,
    );
  });

  await flushAsyncWork();

  const usage = await repo.usage.listAll();
  assertEquals(usage.length, 1);
  assertEquals(usage[0].keyId, apiKey.id);
  assertEquals(usage[0].model, "claude-chat-usage-hidden");
  assertEquals(usage[0].inputTokens, 14);
  assertEquals(usage[0].outputTokens, 6);
  assertEquals(usage[0].cacheReadTokens, 0);
  assertEquals(usage[0].cacheCreationTokens, 0);

  const updatedKey = await repo.apiKeys.getById(apiKey.id);
  assertExists(updatedKey?.lastUsedAt);
});

Deno.test("usage middleware records final cumulative Messages stream usage", async () => {
  const { repo, apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        { id: "claude-cumulative", supported_endpoints: ["/v1/messages"] },
      ]));
    }
    if (url.pathname === "/v1/messages") {
      return sseResponse([
        {
          event: "message_start",
          data: {
            type: "message_start",
            message: {
              id: "msg_cumulative_usage",
              type: "message",
              role: "assistant",
              content: [],
              model: "claude-cumulative",
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 0 },
            },
          },
        },
        {
          event: "message_delta",
          data: {
            type: "message_delta",
            delta: {},
            usage: { output_tokens: 2 },
          },
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
        model: "claude-cumulative",
        max_tokens: 64,
        stream: true,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 200);
    await response.text();
  });

  await flushAsyncWork();

  const usage = await repo.usage.listAll();
  assertEquals(usage.length, 1);
  assertEquals(usage[0].inputTokens, 10);
  assertEquals(usage[0].outputTokens, 5);
});

Deno.test("usage middleware records final visible Chat usage chunks", async () => {
  const { repo, apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        {
          id: "claude-chat-cumulative",
          supported_endpoints: ["/v1/messages"],
        },
      ]));
    }
    if (url.pathname === "/v1/messages") {
      return sseResponse([
        {
          event: "message_start",
          data: {
            type: "message_start",
            message: {
              id: "msg_chat_cumulative",
              type: "message",
              role: "assistant",
              content: [],
              model: "claude-chat-cumulative",
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 12, output_tokens: 0 },
            },
          },
        },
        {
          event: "message_delta",
          data: {
            type: "message_delta",
            delta: {},
            usage: { output_tokens: 3 },
          },
        },
        {
          event: "message_delta",
          data: {
            type: "message_delta",
            delta: { stop_reason: "end_turn", stop_sequence: null },
            usage: { output_tokens: 8 },
          },
        },
        { event: "message_stop", data: { type: "message_stop" } },
      ]);
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const response = await requestApp("/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
      },
      body: JSON.stringify({
        model: "claude-chat-cumulative",
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 200);
    const events = parseSSEText(await response.text());
    const visibleUsageChunks = events.filter((event) => {
      if (event.data === "[DONE]") return false;
      const data = JSON.parse(event.data) as Record<string, unknown>;
      return Array.isArray(data.choices) && data.choices.length === 0 &&
        "usage" in data;
    });
    assertEquals(visibleUsageChunks.length, 2);
  });

  await flushAsyncWork();

  const usage = await repo.usage.listAll();
  assertEquals(usage.length, 1);
  assertEquals(usage[0].inputTokens, 12);
  assertEquals(usage[0].outputTokens, 8);
});

Deno.test("usage middleware records Responses via Messages usage once", async () => {
  const { repo, apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        {
          id: "claude-responses-cumulative",
          supported_endpoints: ["/v1/messages"],
        },
      ]));
    }
    if (url.pathname === "/v1/messages") {
      return sseResponse([
        {
          event: "message_start",
          data: {
            type: "message_start",
            message: {
              id: "msg_responses_cumulative",
              type: "message",
              role: "assistant",
              content: [],
              model: "claude-responses-cumulative",
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 7, output_tokens: 0 },
            },
          },
        },
        {
          event: "message_delta",
          data: {
            type: "message_delta",
            delta: {},
            usage: { output_tokens: 4 },
          },
        },
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
        model: "claude-responses-cumulative",
        input: "Hi",
        stream: true,
      }),
    });

    assertEquals(response.status, 200);
    await response.text();
  });

  await flushAsyncWork();

  const usage = await repo.usage.listAll();
  assertEquals(usage.length, 1);
  assertEquals(usage[0].inputTokens, 7);
  assertEquals(usage[0].outputTokens, 9);
});

Deno.test("usage middleware records embeddings usage when upstream omits model field", async () => {
  // Regression: GitHub Copilot's /embeddings response does NOT include a
  // `model` field. After d8dd086 added requireUsageModel(), the chat-class
  // serves were updated to write usageModel metadata, but the embeddings
  // serve was missed, so /v1/embeddings returned 500. The embeddings serve
  // now mirrors the chat-class pattern by carrying the requested model
  // through usage metadata.
  const { repo, apiKey } = await setupAppTest();

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({
        token: "copilot-access-token",
        expires_at: 4102444800,
        refresh_in: 3600,
      });
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        {
          id: "text-embedding-3-small",
          supported_endpoints: ["/embeddings"],
        },
      ]));
    }
    if (url.pathname === "/embeddings") {
      // Real GitHub Copilot embeddings response: usage present, model absent.
      return jsonResponse({
        object: "list",
        data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }],
        usage: { prompt_tokens: 4, total_tokens: 4 },
      });
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const response = await requestApp("/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: ["hello"],
      }),
    });

    assertEquals(response.status, 200);
    await response.json();
  });

  await flushAsyncWork();

  const usage = await repo.usage.listAll();
  assertEquals(usage.length, 1);
  // Falls back to the requested model carried via usage metadata.
  assertEquals(usage[0].model, "text-embedding-3-small");
  assertEquals(usage[0].inputTokens, 4);
});
