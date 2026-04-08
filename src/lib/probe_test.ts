import { assertEquals } from "@std/assert";
import { clearProbeCache, getOrProbe } from "./probe.ts";
import { setupAppTest } from "../test-helpers.ts";

function withFakeNow<T>(times: number[], run: () => Promise<T>): Promise<T> {
  const originalNow = Date.now;
  let index = 0;
  Date.now = () => times[Math.min(index++, times.length - 1)];
  return run().finally(() => {
    Date.now = originalNow;
  });
}

Deno.test("probe cache reuses repo-backed results after in-process cache is cleared", async () => {
  await setupAppTest();
  clearProbeCache();

  let probeCalls = 0;

  await withFakeNow([0, 0, 1_000, 1_000], async () => {
    const first = await getOrProbe({
      key: "test-probe",
      version: "1",
      ttlMs: 10_000,
      scope: { model: "gpt-test", accountType: "individual" },
      validate: (value): value is number => typeof value === "number",
      probe: () => Promise.resolve(++probeCalls),
    });

    clearProbeCache();

    const second = await getOrProbe({
      key: "test-probe",
      version: "1",
      ttlMs: 10_000,
      scope: { model: "gpt-test", accountType: "individual" },
      validate: (value): value is number => typeof value === "number",
      probe: () => Promise.resolve(++probeCalls),
    });

    assertEquals(first, 1);
    assertEquals(second, 1);
  });

  assertEquals(probeCalls, 1);
});

Deno.test("probe cache re-probes after ttl expiry", async () => {
  await setupAppTest();
  clearProbeCache();

  let probeCalls = 0;

  await withFakeNow([0, 0, 20_000, 20_000], async () => {
    const first = await getOrProbe({
      key: "expiring-probe",
      version: "1",
      ttlMs: 1_000,
      scope: { model: "gpt-test", accountType: "individual" },
      validate: (value): value is number => typeof value === "number",
      probe: () => Promise.resolve(++probeCalls),
    });

    clearProbeCache();

    const second = await getOrProbe({
      key: "expiring-probe",
      version: "1",
      ttlMs: 1_000,
      scope: { model: "gpt-test", accountType: "individual" },
      validate: (value): value is number => typeof value === "number",
      probe: () => Promise.resolve(++probeCalls),
    });

    assertEquals(first, 1);
    assertEquals(second, 2);
  });

  assertEquals(probeCalls, 2);
});
