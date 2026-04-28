import { assertEquals } from "@std/assert";
import { clearCopilotTokenCache } from "./copilot.ts";
import { clearModelsCache, findModel, getModels } from "./models-cache.ts";
import { jsonResponse, setupAppTest, withMockedFetch } from "../test-helpers.ts";

function withFakeNow<T>(times: number[], run: () => Promise<T>): Promise<T> {
  const originalNow = Date.now;
  let index = 0;
  Date.now = () => times[Math.min(index++, times.length - 1)];
  return run().finally(() => {
    Date.now = originalNow;
  });
}

Deno.test("models cache uses L1 cache for 120s and L2 cache for 600s", async () => {
  const { githubAccount } = await setupAppTest();
  clearModelsCache();
  await clearCopilotTokenCache();

  let modelsFetches = 0;

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({ token: "copilot-access-token", expires_at: 4102444800, refresh_in: 3600 });
    }
    if (url.pathname === "/models") {
      modelsFetches++;
      return jsonResponse({
        object: "list",
        data: [{
          id: "claude-sonnet-4",
          name: "claude-sonnet-4",
          version: "1",
          object: "model",
          supported_endpoints: ["/v1/messages"],
          capabilities: { family: "claude", type: "chat", limits: {}, supports: {} },
        }],
      });
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    await withFakeNow([0, 60_000, 130_000], async () => {
      const first = await getModels(githubAccount.token, githubAccount.accountType);
      const second = await getModels(githubAccount.token, githubAccount.accountType);
      const third = await getModels(githubAccount.token, githubAccount.accountType);

      assertEquals(first.data[0].id, "claude-sonnet-4");
      assertEquals(second.data[0].id, "claude-sonnet-4");
      assertEquals(third.data[0].id, "claude-sonnet-4");
    });
  });

  assertEquals(modelsFetches, 1);
});

Deno.test("models cache refreshes upstream after repo-backed cache expires", async () => {
  const { githubAccount } = await setupAppTest();
  clearModelsCache();
  await clearCopilotTokenCache();

  let modelsFetches = 0;

  await withMockedFetch((request) => {
    const url = new URL(request.url);

    if (url.hostname === "update.code.visualstudio.com") {
      return jsonResponse(["1.110.1"]);
    }
    if (url.pathname === "/copilot_internal/v2/token") {
      return jsonResponse({ token: "copilot-access-token", expires_at: 4102444800, refresh_in: 3600 });
    }
    if (url.pathname === "/models") {
      modelsFetches++;
      return jsonResponse({
        object: "list",
        data: [{
          id: `model-${modelsFetches}`,
          name: `model-${modelsFetches}`,
          version: "1",
          object: "model",
          supported_endpoints: ["/responses"],
          capabilities: { family: "gpt", type: "chat", limits: {}, supports: {} },
        }],
      });
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    await withFakeNow([0, 610_000], async () => {
      const first = await getModels(githubAccount.token, githubAccount.accountType);
      const second = await getModels(githubAccount.token, githubAccount.accountType);

      assertEquals(first.data[0].id, "model-1");
      assertEquals(second.data[0].id, "model-2");
    });
  });

  assertEquals(modelsFetches, 2);
});

Deno.test("findModel applies dated Claude aliases only after exact model misses", async () => {
  const { githubAccount } = await setupAppTest();
  clearModelsCache();
  await clearCopilotTokenCache();

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
      return jsonResponse({
        object: "list",
        data: [
          {
            id: "claude-haiku-4.5-20251001",
            name: "claude-haiku-4.5-20251001",
            version: "1",
            object: "model",
            supported_endpoints: ["/chat/completions"],
            capabilities: {
              family: "claude",
              type: "chat",
              limits: {},
              supports: {},
            },
          },
          {
            id: "claude-haiku-4.5",
            name: "claude-haiku-4.5",
            version: "1",
            object: "model",
            supported_endpoints: ["/v1/messages"],
            capabilities: {
              family: "claude",
              type: "chat",
              limits: {},
              supports: {},
            },
          },
          {
            id: "claude-opus-4.7",
            name: "claude-opus-4.7",
            version: "1",
            object: "model",
            supported_endpoints: ["/v1/messages"],
            capabilities: {
              family: "claude",
              type: "chat",
              limits: {},
              supports: {},
            },
          },
          {
            id: "claude-sonnet-4.5",
            name: "claude-sonnet-4.5",
            version: "1",
            object: "model",
            supported_endpoints: ["/responses"],
            capabilities: {
              family: "claude",
              type: "chat",
              limits: {},
              supports: {},
            },
          },
        ],
      });
    }

    throw new Error(`Unhandled fetch ${request.url}`);
  }, async () => {
    const exact = await findModel(
      "claude-haiku-4.5-20251001",
      githubAccount.token,
      githubAccount.accountType,
    );
    const fallbackDotted = await findModel(
      "claude-opus-4.7-20251001",
      githubAccount.token,
      githubAccount.accountType,
    );
    const fallbackDashed = await findModel(
      "claude-sonnet-4-5-20251001",
      githubAccount.token,
      githubAccount.accountType,
    );

    assertEquals(exact?.id, "claude-haiku-4.5-20251001");
    assertEquals(fallbackDotted?.id, "claude-opus-4.7");
    assertEquals(fallbackDashed?.id, "claude-sonnet-4.5");
  });
});
