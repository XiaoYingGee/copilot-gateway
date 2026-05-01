import { assertEquals, assertExists } from "@std/assert";
import {
  copilotModels,
  flushAsyncWork,
  jsonResponse,
  requestApp,
  setupAppTest,
  withMockedFetch,
} from "../../test-helpers.ts";

Deno.test("/v1/embeddings wraps scalar string input for Copilot upstream", async () => {
  const { apiKey } = await setupAppTest();
  let forwardedBody: {
    model?: unknown;
    input?: unknown;
    encoding_format?: unknown;
  } | undefined;

  await withMockedFetch(async (request) => {
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
      forwardedBody = await request.json() as Record<string, unknown>;
      return jsonResponse({
        object: "list",
        model: "text-embedding-real",
        data: [{ object: "embedding", index: 0, embedding: [0.1] }],
        usage: { prompt_tokens: 1, total_tokens: 1 },
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
        encoding_format: "float",
      }),
    });

    assertEquals(response.status, 200);
    await response.json();
  });

  assertExists(forwardedBody);
  assertEquals(forwardedBody.model, "text-embedding-real");
  assertEquals(forwardedBody.input, ["hello"]);
  assertEquals(forwardedBody.encoding_format, "float");
});

Deno.test("/v1/embeddings records usage under request model when upstream omits model", async () => {
  const { apiKey, repo } = await setupAppTest();

  await withMockedFetch(async (request) => {
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
        data: [{ object: "embedding", index: 0, embedding: [0.1] }],
        usage: { prompt_tokens: 1, total_tokens: 1 },
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
        encoding_format: "float",
      }),
    });

    assertEquals(response.status, 200);
    await response.json();
  });

  await flushAsyncWork();

  const usage = await repo.usage.listAll();
  assertEquals(usage.length, 1);
  assertEquals(usage[0].model, "text-embedding-real");
  assertEquals(usage[0].inputTokens, 1);
});
