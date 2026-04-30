import { assertEquals, assertRejects } from "@std/assert";
import { initRepo } from "../../../repo/index.ts";
import { InMemoryRepo } from "../../../repo/memory.ts";
import { withUpstreamSuccessTelemetry } from "./telemetry.ts";

const throwingEvents = async function* () {
  yield { type: "first" };
  throw new Error("stream failed");
};

Deno.test("withUpstreamSuccessTelemetry does not record interrupted upstream streams as success", async () => {
  const repo = new InMemoryRepo();
  initRepo(repo);
  const background: Promise<unknown>[] = [];

  const events = withUpstreamSuccessTelemetry(
    throwingEvents(),
    {
      sourceApi: "messages",
      payload: { model: "claude-broken", stream: true },
      githubToken: "token",
      accountType: "individual",
      apiKeyId: "key_a",
      clientStream: true,
      runtimeLocation: "SJC",
      scheduleBackground: (promise) => background.push(promise),
    },
    "messages",
    performance.now(),
  );

  await assertRejects(
    async () => {
      for await (const _event of events) {
        // Consume until the upstream iterable reports its failure.
      }
    },
    Error,
    "stream failed",
  );
  await Promise.all(background);

  assertEquals(await repo.performance.listAll(), []);
});

Deno.test("withUpstreamSuccessTelemetry does not record failed Responses JSON as success", async () => {
  const repo = new InMemoryRepo();
  initRepo(repo);
  const background: Promise<unknown>[] = [];

  const events = withUpstreamSuccessTelemetry(
    (async function* () {
      yield {
        type: "json" as const,
        data: {
          id: "resp_failed",
          object: "response",
          model: "gpt-failed-json",
          status: "failed",
          output: [],
          output_text: "",
          error: { type: "server_error", message: "failed" },
        },
      };
    })(),
    {
      sourceApi: "responses",
      payload: { model: "gpt-failed-json", stream: false },
      githubToken: "token",
      accountType: "individual",
      apiKeyId: "key_a",
      clientStream: false,
      runtimeLocation: "SJC",
      scheduleBackground: (promise) => background.push(promise),
    },
    "responses",
    performance.now(),
  );

  for await (const _event of events) {
    // Consume every upstream frame.
  }
  await Promise.all(background);

  assertEquals(await repo.performance.listAll(), []);
});

Deno.test("withUpstreamSuccessTelemetry does not treat DONE as Messages or Responses success", async () => {
  for (const targetApi of ["messages", "responses"] as const) {
    const repo = new InMemoryRepo();
    initRepo(repo);
    const background: Promise<unknown>[] = [];

    const events = withUpstreamSuccessTelemetry(
      (async function* () {
        yield { type: "sse" as const, data: "[DONE]" };
      })(),
      {
        sourceApi: targetApi,
        payload: { model: `gpt-${targetApi}-done`, stream: true },
        githubToken: "token",
        accountType: "individual",
        apiKeyId: "key_a",
        clientStream: true,
        runtimeLocation: "SJC",
        scheduleBackground: (promise) => background.push(promise),
      },
      targetApi,
      performance.now(),
    );

    for await (const _event of events) {
      // Consume every upstream frame.
    }
    await Promise.all(background);

    assertEquals(await repo.performance.listAll(), []);
  }
});

Deno.test("withUpstreamSuccessTelemetry snapshots duration when the success frame arrives", async () => {
  const repo = new InMemoryRepo();
  initRepo(repo);
  const background: Promise<unknown>[] = [];
  const startedAt = performance.now();

  const iterator = withUpstreamSuccessTelemetry(
    (async function* () {
      yield { type: "sse" as const, data: '{"type":"message_stop"}' };
    })(),
    {
      sourceApi: "messages",
      payload: { model: "claude-timing", stream: true },
      githubToken: "token",
      accountType: "individual",
      apiKeyId: "key_a",
      clientStream: true,
      runtimeLocation: "SJC",
      scheduleBackground: (promise) => background.push(promise),
    },
    "messages",
    startedAt,
  )[Symbol.asyncIterator]();

  assertEquals((await iterator.next()).done, false);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assertEquals((await iterator.next()).done, true);
  await Promise.all(background);

  const rows = await repo.performance.listAll();
  assertEquals(rows.length, 1);
  assertEquals(rows[0].metricScope, "upstream_success");
  assertEquals(rows[0].totalMsSum < 40, true);
});
