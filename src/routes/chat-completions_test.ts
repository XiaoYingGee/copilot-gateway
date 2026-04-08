import { assertEquals, assertExists, assertFalse } from "@std/assert";
import {
  copilotModels,
  jsonResponse,
  requestApp,
  setupAppTest,
  sseResponse,
  withMockedFetch,
} from "../test-helpers.ts";

Deno.test("/v1/chat/completions with thinking_budget prefers responses on dual-endpoint models", async () => {
  const { apiKey } = await setupAppTest();

  let upstreamBody: Record<string, unknown> | undefined;

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
        {
          id: "gpt-chat-dual",
          supported_endpoints: ["/responses", "/chat/completions"],
        },
      ]));
    }
    if (url.pathname === "/chat/completions") {
      throw new Error(
        "chat/completions should not be used when responses is available for thinking_budget",
      );
    }
    if (url.pathname === "/responses") {
      const body = JSON.parse(await request.text()) as Record<string, unknown>;
      if ((body.max_output_tokens as number | undefined) === 1) {
        const reasoning = body.reasoning as Record<string, unknown> | undefined;
        if (!reasoning) return jsonResponse({ ok: true });
        const effort = reasoning.effort;
        return effort === "low" || effort === "medium"
          ? jsonResponse({ ok: true })
          : jsonResponse({ error: { message: "unsupported effort" } }, 400);
      }

      upstreamBody = body;
      return sseResponse([
        {
          event: "response.completed",
          data: {
            type: "response.completed",
            response: {
              id: "resp_chat_dual",
              object: "response",
              model: "gpt-chat-dual",
              status: "completed",
              output_text: "ok",
              output: [
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: "ok" }],
                },
              ],
              usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
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
        model: "gpt-chat-dual",
        max_tokens: 256,
        thinking_budget: 21332,
        stream: false,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.choices[0].message.content, "ok");
  });

  assertExists(upstreamBody);
  assertEquals(
    (upstreamBody!.reasoning as Record<string, unknown>).effort,
    "medium",
  );
  const input = upstreamBody!.input as Array<Record<string, unknown>>;
  assertEquals((input[0] as Record<string, unknown>).type, "message");
});

Deno.test("/v1/chat/completions drops unsupported thinking_budget on chat-only models", async () => {
  const { apiKey } = await setupAppTest();

  let upstreamBody: Record<string, unknown> | undefined;

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
        {
          id: "gpt-chat-only-budgetless",
          supported_endpoints: ["/chat/completions"],
        },
      ]));
    }
    if (url.pathname === "/chat/completions") {
      const body = JSON.parse(await request.text()) as Record<string, unknown>;
      if ((body.max_tokens as number | undefined) === 1) {
        return body.thinking_budget
          ? jsonResponse(
            { error: { message: "unsupported thinking_budget" } },
            400,
          )
          : jsonResponse({ ok: true });
      }

      upstreamBody = body;
      return jsonResponse({
        id: "chatcmpl_final",
        object: "chat.completion",
        created: 1,
        model: "gpt-chat-only-budgetless",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "ok" },
          finish_reason: "stop",
        }],
      });
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
        model: "gpt-chat-only-budgetless",
        max_tokens: 256,
        thinking_budget: 4096,
        stream: false,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.choices[0].message.content, "ok");
  });

  assertExists(upstreamBody);
  assertFalse("thinking_budget" in upstreamBody!);
});
