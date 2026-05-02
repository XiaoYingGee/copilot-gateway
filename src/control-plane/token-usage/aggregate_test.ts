import { assertAlmostEquals, assertEquals } from "@std/assert";
import { aggregateUsageForDisplay } from "./aggregate.ts";
import type { UsageRecord } from "../../repo/types.ts";

const baseRecord = (overrides: Partial<UsageRecord>): UsageRecord => ({
  keyId: "key-1",
  hour: "2026-05-01T00",
  model: "claude-opus-4.7",
  requests: 1,
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  ...overrides,
});

Deno.test("aggregateUsageForDisplay merges Claude variants into one row per base id", () => {
  const records: UsageRecord[] = [
    baseRecord({ model: "claude-opus-4.7", requests: 2, inputTokens: 100 }),
    baseRecord({
      model: "claude-opus-4.7-xhigh",
      requests: 3,
      inputTokens: 200,
    }),
    baseRecord({
      model: "claude-opus-4.7-1m-internal",
      requests: 1,
      inputTokens: 50,
    }),
  ];

  const out = aggregateUsageForDisplay(records);
  assertEquals(out.length, 1);
  assertEquals(out[0].model, "claude-opus-4-7");
  assertEquals(out[0].requests, 6);
  assertEquals(out[0].inputTokens, 350);
});

Deno.test("aggregateUsageForDisplay keeps cost accurate when variants share pricing", () => {
  // All three Claude opus 4.7 variants share the same pricing in the
  // merged-id pricing table, so per-record cost equals base-id cost. We assert
  // that cost ≠ 0 and matches the base recipe.
  const records: UsageRecord[] = [
    baseRecord({ model: "claude-opus-4.7-xhigh", inputTokens: 1_000_000 }),
  ];
  const out = aggregateUsageForDisplay(records);
  // 1M input * $5/1M = $5; output 50 tokens * $25/1M ≈ $0.00125. total ≈ 5.00125
  assertAlmostEquals(out[0].cost, 5 + 50 * 25 / 1e6, 1e-9);
});

Deno.test("aggregateUsageForDisplay sums cost across grouped raw records", () => {
  const records: UsageRecord[] = [
    baseRecord({ model: "gpt-5.4", inputTokens: 1_000_000, outputTokens: 0 }),
    baseRecord({ model: "gpt-5.4", inputTokens: 1_000_000, outputTokens: 0 }),
  ];
  const out = aggregateUsageForDisplay(records);
  assertEquals(out.length, 1);
  // 2 * 1M * $2.5/1M = $5
  assertAlmostEquals(out[0].cost, 5, 1e-9);
});

Deno.test("aggregateUsageForDisplay leaves storage-bound shape on the input untouched", () => {
  const original: UsageRecord = baseRecord({ inputTokens: 42 });
  aggregateUsageForDisplay([original]);
  assertEquals(original.model, "claude-opus-4.7");
  assertEquals(original.inputTokens, 42);
});
