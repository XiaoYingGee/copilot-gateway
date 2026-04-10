import { assertEquals, assertExists } from "@std/assert";
import { requestApp, setupAppTest } from "./test-helpers.ts";

Deno.test("admin key is limited to control plane routes", async () => {
  const { adminKey } = await setupAppTest();

  const exportResponse = await requestApp("/api/export", {
    headers: { "x-api-key": adminKey },
  });
  assertEquals(exportResponse.status, 200);

  const modelsResponse = await requestApp("/v1/models", {
    headers: { "x-api-key": adminKey },
  });
  assertEquals(modelsResponse.status, 403);
  assertEquals(await modelsResponse.json(), {
    error: "This key is for dashboard only. Create an API key for API access.",
  });
});

Deno.test("API key users only see their own key in /api/keys", async () => {
  const { repo, apiKey } = await setupAppTest();
  await repo.apiKeys.save({
    id: "key_other",
    name: "Other key",
    key: "raw_other_key",
    createdAt: "2026-03-15T00:00:00.000Z",
  });

  const response = await requestApp("/api/keys", {
    headers: { "x-api-key": apiKey.key },
  });

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.length, 1);
  assertEquals(body[0].id, apiKey.id);
  assertEquals(body[0].key, apiKey.key);
});

Deno.test("API key users cannot call admin-only key mutation routes", async () => {
  const { apiKey } = await setupAppTest();

  const response = await requestApp(`/api/keys/${apiKey.id}/rotate`, {
    method: "POST",
    headers: { "x-api-key": apiKey.key },
  });

  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: "Dashboard key required" });
});

Deno.test("/api/token-usage is visible to any authenticated user and includes all keys", async () => {
  const { repo, apiKey } = await setupAppTest();
  await repo.apiKeys.save({
    id: "key_other",
    name: "Other key",
    key: "raw_other_key",
    createdAt: "2026-03-15T00:00:00.000Z",
  });
  await repo.usage.set({
    keyId: apiKey.id,
    model: "claude-sonnet-4",
    hour: "2026-03-15T10",
    requests: 2,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  });
  await repo.usage.set({
    keyId: "key_other",
    model: "gpt-5",
    hour: "2026-03-15T11",
    requests: 1,
    inputTokens: 20,
    outputTokens: 8,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  });

  const response = await requestApp("/api/token-usage?start=2026-03-15T00&end=2026-03-16T00", {
    headers: { "x-api-key": apiKey.key },
  });

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.length, 2);
  assertEquals(body[0].keyName, "Primary key");
  assertEquals(body[1].keyName, "Other key");
  assertExists(body.find((record: { keyId: string }) => record.keyId === apiKey.id));
  assertExists(body.find((record: { keyId: string }) => record.keyId === "key_other"));
});
