import {
  type PerformanceTelemetryContext,
  recordPerformanceLatency,
} from "../../../lib/performance-telemetry.ts";
import { scheduleBackground } from "../../../lib/background.ts";
import type { PerformanceApiName } from "../../../repo/types.ts";
import type { EmitInput } from "./emit-types.ts";
import type { SseFrame, StreamFrame } from "../shared/stream/types.ts";
import { chatCompletionsErrorPayloadMessage } from "../../../lib/chat-completions-errors.ts";

export function withUpstreamSuccessTelemetry<T>(
  events: AsyncIterable<T>,
  input: EmitInput<{ model: string; stream?: boolean | null }>,
  targetApi: PerformanceApiName,
  startedAt: number,
): AsyncIterable<T> {
  return (async function* () {
    let recorded = false;
    const recordOnce = (durationMs: number) => {
      if (recorded || !input.apiKeyId) return;
      recorded = true;
      scheduleBackground(
        input.scheduleBackground,
        recordPerformanceLatency(
          upstreamContext(input, targetApi),
          "upstream_success",
          durationMs,
        ),
      );
    };

    for await (const event of events) {
      const isSuccessfulFrame = isSuccessfulUpstreamFrame(event, targetApi);
      const successDurationMs = isSuccessfulFrame
        ? performance.now() - startedAt
        : 0;
      try {
        yield event;
      } finally {
        // Source protocol collectors intentionally stop at terminal events and
        // may never pull the raw upstream stream to EOF, so record success when
        // a target-owned success marker has been delivered downstream.
        if (isSuccessfulFrame) recordOnce(successDurationMs);
      }
    }
  })();
}

function isSuccessfulUpstreamFrame(
  value: unknown,
  targetApi: PerformanceApiName,
): boolean {
  if (!isStreamFrame(value)) return false;
  if (value.type === "json") {
    return isSuccessfulUpstreamJsonFrame(value.data, targetApi);
  }
  return isSuccessfulUpstreamSseFrame(value, targetApi);
}

function isSuccessfulUpstreamJsonFrame(
  data: unknown,
  targetApi: PerformanceApiName,
): boolean {
  if (targetApi === "responses") {
    return (data as { status?: unknown }).status !== "failed";
  }
  if (targetApi === "messages") {
    return (data as { type?: unknown }).type !== "error";
  }
  return !chatCompletionsErrorPayloadMessage(data);
}

function isStreamFrame(value: unknown): value is StreamFrame<unknown> {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  if (type === "json") return true;
  return type === "sse" &&
    typeof (value as { data?: unknown }).data === "string";
}

function isSuccessfulUpstreamSseFrame(
  frame: SseFrame,
  targetApi: PerformanceApiName,
): boolean {
  const data = frame.data.trim();
  if (data === "[DONE]") return targetApi === "chat-completions";

  let eventType = frame.event;
  try {
    const parsed = JSON.parse(data) as { type?: unknown };
    if (typeof parsed.type === "string") eventType = parsed.type;
  } catch {
    return false;
  }

  if (targetApi === "messages") return eventType === "message_stop";
  if (targetApi === "responses") {
    return eventType === "response.completed" ||
      eventType === "response.incomplete";
  }
  return false;
}

function upstreamContext(
  input: EmitInput<{ model: string; stream?: boolean | null }>,
  targetApi: PerformanceApiName,
): PerformanceTelemetryContext {
  return {
    keyId: input.apiKeyId ?? "unknown",
    model: input.payload.model,
    sourceApi: input.sourceApi,
    targetApi,
    stream: input.clientStream ?? input.payload.stream === true,
    runtimeLocation: input.runtimeLocation ?? "unknown",
  };
}
