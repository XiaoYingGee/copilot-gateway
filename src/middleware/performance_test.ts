import { assertEquals, assertExists, assertRejects } from "@std/assert";
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

Deno.test("performance telemetry records request total and upstream success latencies", async () => {
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
        id: "msg_perf",
        type: "message",
        role: "assistant",
        model: "claude-native",
        content: [{ type: "text", text: "ok" }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
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

  const rows = await repo.performance.query({
    start: "2026-01-01T00",
    end: "9999-01-01T00",
  });
  const requestTotal = rows.find((row) => row.metricScope === "request_total");
  const upstreamSuccess = rows.find((row) =>
    row.metricScope === "upstream_success"
  );
  assertExists(requestTotal);
  assertExists(upstreamSuccess);
  assertEquals(requestTotal.keyId, apiKey.id);
  assertEquals(requestTotal.model, "claude-native");
  assertEquals(requestTotal.sourceApi, "messages");
  assertEquals(requestTotal.targetApi, "messages");
  assertEquals(requestTotal.stream, false);
  assertEquals(requestTotal.runtimeLocation, "unknown");
  assertEquals(requestTotal.requests, 1);
  assertEquals(upstreamSuccess.requests, 1);
});

Deno.test("performance telemetry treats usage flush failures as request errors", async () => {
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
        { id: "gpt-usage-flush-failure", supported_endpoints: ["/responses"] },
      ]));
    }
    if (url.pathname === "/responses") {
      return sseResponse([{
        event: "response.completed",
        data: {
          type: "response.completed",
          response: {
            id: "resp_usage_flush_failure",
            object: "response",
            model: "gpt-usage-flush-failure",
            status: "completed",
            output: [],
            output_text: "",
            usage: {
              input_tokens: 7,
              output_tokens: 3,
              total_tokens: 10,
            },
          },
        },
      }]);
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
        model: "gpt-usage-flush-failure",
        stream: true,
        input: [{ type: "message", role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 200);
    await assertRejects(
      () => response.text(),
      Error,
      "usage write failed",
    );
  });

  await flushAsyncWork();

  const rows = await repo.performance.query({
    start: "2026-01-01T00",
    end: "9999-01-01T00",
  });
  const requestTotal = rows.find((row) => row.metricScope === "request_total");
  assertExists(requestTotal);
  assertEquals(requestTotal.model, "gpt-usage-flush-failure");
  assertEquals(requestTotal.sourceApi, "responses");
  assertEquals(requestTotal.targetApi, "responses");
  assertEquals(requestTotal.stream, true);
  assertEquals(requestTotal.requests, 0);
  assertEquals(requestTotal.errors, 1);
  assertEquals(requestTotal.buckets.length, 0);
});

Deno.test("performance telemetry keeps resolved dimensions when source attempt setup throws", async () => {
  const cases = [
    {
      path: "/v1/messages",
      model: "claude-attempt-setup-throws",
      sourceApi: "messages",
      endpoints: ["/v1/messages"],
      body: {
        model: "claude-attempt-setup-throws",
        max_tokens: 64,
        stream: true,
        messages: [{ role: "user", content: "Hi" }],
      },
    },
    {
      path: "/v1/responses",
      model: "gpt-responses-attempt-setup-throws",
      sourceApi: "responses",
      endpoints: ["/responses"],
      body: {
        model: "gpt-responses-attempt-setup-throws",
        stream: true,
        input: [{ type: "message", role: "user", content: "Hi" }],
      },
    },
    {
      path: "/v1/chat/completions",
      model: "gpt-chat-attempt-setup-throws",
      sourceApi: "chat-completions",
      endpoints: ["/chat/completions"],
      body: {
        model: "gpt-chat-attempt-setup-throws",
        stream: true,
        messages: [{ role: "user", content: "Hi" }],
      },
    },
  ] as const;

  for (const testCase of cases) {
    const { repo, apiKey } = await setupAppTest();
    const originalStructuredClone = globalThis.structuredClone;
    globalThis.structuredClone = (() => {
      throw new Error("attempt setup failed");
    }) as typeof structuredClone;

    try {
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
          return jsonResponse(copilotModels([{
            id: testCase.model,
            supported_endpoints: [...testCase.endpoints],
          }]));
        }
        throw new Error(`Unhandled fetch ${request.url}`);
      }, async () => {
        const response = await requestApp(testCase.path, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey.key,
          },
          body: JSON.stringify(testCase.body),
        });

        assertEquals(response.status, 502);
        await response.json();
      });
    } finally {
      globalThis.structuredClone = originalStructuredClone;
    }

    await flushAsyncWork();

    const rows = await repo.performance.query({
      start: "2026-01-01T00",
      end: "9999-01-01T00",
    });
    assertEquals(rows.length, 1);
    assertEquals(rows[0].metricScope, "request_total");
    assertEquals(rows[0].model, testCase.model);
    assertEquals(rows[0].sourceApi, testCase.sourceApi);
    assertEquals(rows[0].targetApi, testCase.sourceApi);
    assertEquals(rows[0].stream, true);
    assertEquals(rows[0].requests, 0);
    assertEquals(rows[0].errors, 1);
    assertEquals(rows[0].buckets.length, 0);
  }
});

Deno.test("performance telemetry records upstream errors under resolved dimensions", async () => {
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
        { id: "claude-error-model", supported_endpoints: ["/v1/messages"] },
      ]));
    }
    if (url.pathname === "/v1/messages") {
      return jsonResponse({ error: { message: "upstream failed" } }, 429);
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
        model: "claude-error-model",
        max_tokens: 64,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 429);
    await response.json();
  });

  await flushAsyncWork();

  const rows = await repo.performance.query({
    start: "2026-01-01T00",
    end: "9999-01-01T00",
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].metricScope, "request_total");
  assertEquals(rows[0].keyId, apiKey.id);
  assertEquals(rows[0].model, "claude-error-model");
  assertEquals(rows[0].sourceApi, "messages");
  assertEquals(rows[0].targetApi, "messages");
  assertEquals(rows[0].stream, false);
  assertEquals(rows[0].errors, 1);
  assertEquals(rows[0].requests, 0);
  assertEquals(rows[0].buckets.length, 0);
});

Deno.test("performance telemetry keeps resolved dimensions after context-window error rewrite", async () => {
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
        { id: "claude-context-model", supported_endpoints: ["/v1/messages"] },
      ]));
    }
    if (url.pathname === "/v1/messages") {
      return jsonResponse({
        error: {
          message: "Request body is too large for model context window",
        },
      }, 400);
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
        model: "claude-context-model",
        max_tokens: 64,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 400);
    await response.json();
  });

  await flushAsyncWork();

  const rows = await repo.performance.query({
    start: "2026-01-01T00",
    end: "9999-01-01T00",
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].metricScope, "request_total");
  assertEquals(rows[0].keyId, apiKey.id);
  assertEquals(rows[0].model, "claude-context-model");
  assertEquals(rows[0].sourceApi, "messages");
  assertEquals(rows[0].targetApi, "messages");
  assertEquals(rows[0].stream, false);
  assertEquals(rows[0].errors, 1);
  assertEquals(rows[0].requests, 0);
  assertEquals(rows[0].buckets.length, 0);
});

Deno.test("performance telemetry marks handled streaming error frames as request errors", async () => {
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
        { id: "claude-stream-error", supported_endpoints: ["/v1/messages"] },
      ]));
    }
    if (url.pathname === "/v1/messages") {
      return new Response("event: message_delta\ndata: not json", {
        headers: { "content-type": "text/event-stream" },
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
        model: "claude-stream-error",
        max_tokens: 64,
        stream: true,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 200);
    const events = parseSSEText(await response.text());
    assertEquals(events.length, 1);
    assertEquals(events[0].event, "error");
  });

  await flushAsyncWork();

  const rows = await repo.performance.query({
    start: "2026-01-01T00",
    end: "9999-01-01T00",
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].metricScope, "request_total");
  assertEquals(rows[0].keyId, apiKey.id);
  assertEquals(rows[0].model, "claude-stream-error");
  assertEquals(rows[0].sourceApi, "messages");
  assertEquals(rows[0].targetApi, "messages");
  assertEquals(rows[0].stream, true);
  assertEquals(rows[0].requests, 0);
  assertEquals(rows[0].errors, 1);
  assertEquals(rows[0].buckets.length, 0);
});

Deno.test("performance telemetry treats protocol error SSE frames as request errors", async () => {
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
        { id: "claude-protocol-error", supported_endpoints: ["/v1/messages"] },
      ]));
    }
    if (url.pathname === "/v1/messages") {
      return new Response(
        'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"try later"}}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
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
        model: "claude-protocol-error",
        max_tokens: 64,
        stream: true,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 200);
    const events = parseSSEText(await response.text());
    assertEquals(events.length, 1);
    assertEquals(events[0].event, "error");
  });

  await flushAsyncWork();

  const rows = await repo.performance.query({
    start: "2026-01-01T00",
    end: "9999-01-01T00",
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].metricScope, "request_total");
  assertEquals(rows[0].model, "claude-protocol-error");
  assertEquals(rows[0].requests, 0);
  assertEquals(rows[0].errors, 1);
  assertEquals(rows[0].buckets.length, 0);
});

Deno.test("performance telemetry treats cancellation after stream terminal as success", async () => {
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
        { id: "claude-terminal-cancel", supported_endpoints: ["/v1/messages"] },
      ]));
    }
    if (url.pathname === "/v1/messages") {
      return new Response(
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
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
        model: "claude-terminal-cancel",
        max_tokens: 64,
        stream: true,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 200);
    const reader = response.body?.getReader();
    assertExists(reader);
    const chunk = await reader.read();
    assertEquals(chunk.done, false);
    await reader.cancel("client stopped after terminal event");
  });

  await flushAsyncWork();

  const rows = await repo.performance.query({
    start: "2026-01-01T00",
    end: "9999-01-01T00",
  });
  const requestTotal = rows.find((row) => row.metricScope === "request_total");
  assertExists(requestTotal);
  assertEquals(requestTotal.model, "claude-terminal-cancel");
  assertEquals(requestTotal.stream, true);
  assertEquals(requestTotal.requests, 1);
  assertEquals(requestTotal.errors, 0);
});

Deno.test("performance telemetry treats cancellation before stream terminal as error", async () => {
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
        { id: "claude-early-cancel", supported_endpoints: ["/v1/messages"] },
      ]));
    }
    if (url.pathname === "/v1/messages") {
      return new Response(
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":null,"stop_sequence":null},"usage":{"output_tokens":0}}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
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
        model: "claude-early-cancel",
        max_tokens: 64,
        stream: true,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 200);
    const reader = response.body?.getReader();
    assertExists(reader);
    const chunk = await reader.read();
    assertEquals(chunk.done, false);
    await reader.cancel("client stopped before terminal event");
  });

  await flushAsyncWork();

  const rows = await repo.performance.query({
    start: "2026-01-01T00",
    end: "9999-01-01T00",
  });
  const requestTotal = rows.find((row) => row.metricScope === "request_total");
  assertExists(requestTotal);
  assertEquals(requestTotal.model, "claude-early-cancel");
  assertEquals(requestTotal.stream, true);
  assertEquals(requestTotal.requests, 0);
  assertEquals(requestTotal.errors, 1);
});

Deno.test("performance telemetry keeps resolved dimensions for non-stream Messages protocol errors", async () => {
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
        { id: "claude-nonstream-error", supported_endpoints: ["/v1/messages"] },
      ]));
    }
    if (url.pathname === "/v1/messages") {
      return new Response(
        'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"try later"}}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
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
        model: "claude-nonstream-error",
        max_tokens: 64,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 502);
    await response.json();
  });

  await flushAsyncWork();

  const rows = await repo.performance.query({
    start: "2026-01-01T00",
    end: "9999-01-01T00",
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].metricScope, "request_total");
  assertEquals(rows[0].model, "claude-nonstream-error");
  assertEquals(rows[0].sourceApi, "messages");
  assertEquals(rows[0].targetApi, "messages");
  assertEquals(rows[0].stream, false);
  assertEquals(rows[0].requests, 0);
  assertEquals(rows[0].errors, 1);
  assertEquals(rows[0].buckets.length, 0);
});

Deno.test("performance telemetry keeps resolved dimensions for non-stream Responses protocol errors", async () => {
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
          id: "gpt-nonstream-response-error",
          supported_endpoints: ["/responses"],
        },
      ]));
    }
    if (url.pathname === "/responses") {
      return new Response(
        'event: error\ndata: {"type":"error","message":"upstream failed"}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
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
        model: "gpt-nonstream-response-error",
        input: [{ type: "message", role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 502);
    await response.json();
  });

  await flushAsyncWork();

  const rows = await repo.performance.query({
    start: "2026-01-01T00",
    end: "9999-01-01T00",
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].metricScope, "request_total");
  assertEquals(rows[0].model, "gpt-nonstream-response-error");
  assertEquals(rows[0].sourceApi, "responses");
  assertEquals(rows[0].targetApi, "responses");
  assertEquals(rows[0].stream, false);
  assertEquals(rows[0].requests, 0);
  assertEquals(rows[0].errors, 1);
  assertEquals(rows[0].buckets.length, 0);
});

Deno.test("performance telemetry keeps resolved dimensions for non-stream Chat protocol errors", async () => {
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
          id: "gpt-nonstream-chat-error",
          supported_endpoints: ["/chat/completions"],
        },
      ]));
    }
    if (url.pathname === "/chat/completions") {
      return new Response(
        'data: {"error":{"type":"server_error","message":"upstream chat failed"}}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
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
        model: "gpt-nonstream-chat-error",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 502);
    await response.json();
  });

  await flushAsyncWork();

  const rows = await repo.performance.query({
    start: "2026-01-01T00",
    end: "9999-01-01T00",
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].metricScope, "request_total");
  assertEquals(rows[0].model, "gpt-nonstream-chat-error");
  assertEquals(rows[0].sourceApi, "chat-completions");
  assertEquals(rows[0].targetApi, "chat-completions");
  assertEquals(rows[0].stream, false);
  assertEquals(rows[0].requests, 0);
  assertEquals(rows[0].errors, 1);
  assertEquals(rows[0].buckets.length, 0);
});

Deno.test("performance telemetry treats Responses failed JSON as request error without upstream success", async () => {
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
        { id: "gpt-failed-json", supported_endpoints: ["/responses"] },
      ]));
    }
    if (url.pathname === "/responses") {
      return jsonResponse({
        id: "resp_failed_json",
        object: "response",
        model: "gpt-failed-json",
        status: "failed",
        output: [],
        output_text: "",
        error: { type: "server_error", message: "upstream failed" },
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
        model: "gpt-failed-json",
        input: [{ type: "message", role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 200);
    assertEquals((await response.json()).status, "failed");
  });

  await flushAsyncWork();

  const rows = await repo.performance.query({
    start: "2026-01-01T00",
    end: "9999-01-01T00",
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].metricScope, "request_total");
  assertEquals(rows[0].model, "gpt-failed-json");
  assertEquals(rows[0].requests, 0);
  assertEquals(rows[0].errors, 1);
});

Deno.test("performance telemetry records unsupported Responses model errors under resolved model", async () => {
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
        { id: "unsupported-responses-model", supported_endpoints: [] },
      ]));
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
        model: "unsupported-responses-model",
        input: [{ type: "message", role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 400);
  });

  await flushAsyncWork();

  const rows = await repo.performance.query({
    start: "2026-01-01T00",
    end: "9999-01-01T00",
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].metricScope, "request_total");
  assertEquals(rows[0].model, "unsupported-responses-model");
  assertEquals(rows[0].requests, 0);
  assertEquals(rows[0].errors, 1);
});
