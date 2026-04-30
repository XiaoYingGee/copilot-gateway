import type { Context } from "hono";
import type { ChatCompletionResponse } from "../lib/chat-completions-types.ts";
import type { PerformanceTelemetryContext } from "../lib/performance-telemetry.ts";

export interface HiddenChatStreamUsageCapture {
  usage?: ChatCompletionResponse["usage"];
}

export interface PerformanceFailureCapture {
  failed?: boolean;
  completed?: boolean;
}

export interface UsageResponseMetadata {
  usageModel?: string;
  hiddenChatStreamUsageCapture?: HiddenChatStreamUsageCapture;
  performance?: PerformanceTelemetryContext;
  performanceFailureCapture?: PerformanceFailureCapture;
}

const USAGE_RESPONSE_METADATA_CONTEXT_KEY =
  "copilotGatewayUsageResponseMetadata";

// Keep accounting metadata on Hono's per-request Context instead of smuggling it
// through Response headers. Headers are part of the client-visible HTTP
// contract; this state is an internal route-to-middleware side channel only.
export function withUsageResponseMetadata(
  c: Context,
  response: Response,
  metadata: UsageResponseMetadata,
): Response {
  const existing = getUsageResponseMetadata(c);
  c.set(USAGE_RESPONSE_METADATA_CONTEXT_KEY, { ...existing, ...metadata });
  return response;
}

export function getUsageResponseMetadata(
  c: Context,
): UsageResponseMetadata | undefined {
  const value = c.get(USAGE_RESPONSE_METADATA_CONTEXT_KEY);
  return isUsageResponseMetadata(value) ? value : undefined;
}

export function getPerformanceResponseMetadata(
  c: Context,
): PerformanceTelemetryContext | undefined {
  return getUsageResponseMetadata(c)?.performance;
}

export function getPerformanceFailureCapture(
  c: Context,
): PerformanceFailureCapture | undefined {
  return getUsageResponseMetadata(c)?.performanceFailureCapture;
}

function isUsageResponseMetadata(
  value: unknown,
): value is UsageResponseMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Partial<UsageResponseMetadata>;
  return (metadata.usageModel === undefined ||
    typeof metadata.usageModel === "string") &&
    (metadata.hiddenChatStreamUsageCapture === undefined ||
      typeof metadata.hiddenChatStreamUsageCapture === "object") &&
    (metadata.performance === undefined ||
      isPerformanceContext(metadata.performance)) &&
    (metadata.performanceFailureCapture === undefined ||
      typeof metadata.performanceFailureCapture === "object");
}

function isPerformanceContext(
  value: unknown,
): value is PerformanceTelemetryContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Partial<PerformanceTelemetryContext>;
  return typeof context.keyId === "string" &&
    typeof context.model === "string" &&
    isLlmApiName(context.sourceApi) &&
    isLlmApiName(context.targetApi) &&
    typeof context.stream === "boolean" &&
    typeof context.runtimeLocation === "string";
}

function isLlmApiName(
  value: unknown,
): value is PerformanceTelemetryContext["sourceApi"] {
  return value === "messages" || value === "responses" ||
    value === "chat-completions";
}
