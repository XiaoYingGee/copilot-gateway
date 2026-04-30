import { assertEquals } from "@std/assert";
import type { PerformanceTelemetryRecord } from "../../repo/types.ts";
import { aggregatePerformanceForDisplay } from "./aggregate.ts";

const record = (
  overrides: Partial<PerformanceTelemetryRecord>,
): PerformanceTelemetryRecord => ({
  hour: "2026-04-30T10",
  metricScope: "request_total",
  keyId: "key_a",
  model: "claude-opus-4.7",
  sourceApi: "messages",
  targetApi: "responses",
  stream: true,
  runtimeLocation: "unknown",
  requests: 1,
  errors: 0,
  totalMsSum: 100,
  buckets: [{ lowerMs: 0, upperMs: 100, count: 1 }],
  ...overrides,
});

Deno.test("aggregatePerformanceForDisplay merges Claude variants before percentile calculation", () => {
  const rows = aggregatePerformanceForDisplay([
    record({
      model: "claude-opus-4.7",
      requests: 90,
      totalMsSum: 9000,
      buckets: [{ lowerMs: 0, upperMs: 100, count: 90 }],
    }),
    record({
      model: "claude-opus-4.7-xhigh",
      requests: 10,
      totalMsSum: 3000,
      buckets: [{ lowerMs: 100, upperMs: 300, count: 10 }],
    }),
  ], { bucket: "hour", groupBy: "model", timezoneOffsetMinutes: 0 });

  assertEquals(rows, [{
    bucket: "2026-04-30T10",
    group: "claude-opus-4-7",
    requests: 100,
    errors: 0,
    totalMsSum: 12000,
    avgMs: 120,
    p50Ms: 100,
    p95Ms: 300,
    p99Ms: 300,
  }]);
});

Deno.test("aggregatePerformanceForDisplay groups days using caller timezone offset", () => {
  const rows = aggregatePerformanceForDisplay([
    record({ hour: "2026-04-30T16" }),
  ], { bucket: "day", groupBy: "none", timezoneOffsetMinutes: -480 });

  assertEquals(rows[0].bucket, "2026-05-01");
});

Deno.test("aggregatePerformanceForDisplay groups hours using caller timezone offset", () => {
  const rows = aggregatePerformanceForDisplay([
    record({ hour: "2026-04-30T16" }),
  ], { bucket: "hour", groupBy: "none", timezoneOffsetMinutes: -480 });

  assertEquals(rows[0].bucket, "2026-05-01T00");
});
