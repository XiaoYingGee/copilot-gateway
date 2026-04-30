import { assertEquals } from "@std/assert";
import {
  copilotModels,
  jsonResponse,
  requestApp,
  setupAppTest,
  withMockedFetch,
} from "../../../../../test-helpers.ts";

function copilotTokenResponse() {
  return jsonResponse({
    token: "fake-copilot-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_in: 1800,
  });
}

Deno.test("/v1/messages/count_tokens proxies to Copilot upstream", async () => {
  const { apiKey } = await setupAppTest();
  let capturedPath = "";

  await withMockedFetch((req) => {
    const url = new URL(req.url);
    if (url.hostname === "api.github.com") return copilotTokenResponse();
    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    capturedPath = url.pathname;
    return jsonResponse({ input_tokens: 42 });
  }, async () => {
    const response = await requestApp("/v1/messages/count_tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
      },
      body: JSON.stringify({
        model: "claude-sonnet-4",
        max_tokens: 64,
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { input_tokens: 42 });
    assertEquals(capturedPath, "/v1/messages/count_tokens");
  });
});

Deno.test("/messages/count_tokens aliases /v1/messages/count_tokens", async () => {
  const { apiKey } = await setupAppTest();
  let capturedPath = "";

  await withMockedFetch((req) => {
    const url = new URL(req.url);
    if (url.hostname === "api.github.com") return copilotTokenResponse();
    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    capturedPath = url.pathname;
    return jsonResponse({ input_tokens: 24 });
  }, async () => {
    const response = await requestApp("/messages/count_tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
      },
      body: JSON.stringify({
        model: "claude-sonnet-4",
        max_tokens: 64,
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { input_tokens: 24 });
    assertEquals(capturedPath, "/v1/messages/count_tokens");
  });
});

Deno.test("/v1/messages/count_tokens resolves Claude compatibility models before proxying", async () => {
  const { apiKey } = await setupAppTest();
  let upstreamBody: Record<string, unknown> | undefined;

  await withMockedFetch(async (req) => {
    const url = new URL(req.url);
    if (url.hostname === "api.github.com") return copilotTokenResponse();
    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/models") {
      return jsonResponse(copilotModels([
        { id: "claude-opus-4.7", supported_endpoints: ["/v1/messages"] },
        {
          id: "claude-opus-4.7-1m-internal",
          supported_endpoints: ["/v1/messages"],
          maxContextWindowTokens: 1_000_000,
          maxPromptTokens: 936_000,
          maxOutputTokens: 64_000,
        },
      ]));
    }
    if (url.pathname === "/v1/messages/count_tokens") {
      upstreamBody = JSON.parse(await req.text()) as Record<string, unknown>;
      return jsonResponse({ input_tokens: 64 });
    }
    throw new Error(`Unhandled fetch ${req.url}`);
  }, async () => {
    const response = await requestApp("/v1/messages/count_tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
        "anthropic-beta": "context-1m-2025-08-07",
      },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        max_tokens: 64,
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { input_tokens: 64 });
  });

  assertEquals(upstreamBody?.model, "claude-opus-4.7-1m-internal");
});
