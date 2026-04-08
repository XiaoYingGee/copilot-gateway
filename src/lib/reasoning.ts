import type { AnthropicMessagesPayload } from "./anthropic-types.ts";
import type { ResponsesPayload } from "./responses-types.ts";

export type ResponsesReasoningEffort = NonNullable<
  NonNullable<ResponsesPayload["reasoning"]>["effort"]
>;

export const RESPONSES_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const satisfies readonly ResponsesReasoningEffort[];

const REASONING_RANK: Record<ResponsesReasoningEffort, number> = {
  none: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
};

export function mapThinkingBudgetToReasoningEffort(
  budgetTokens: number | null | undefined,
): ResponsesReasoningEffort | null {
  if (!budgetTokens) return null;
  if (budgetTokens <= 2048) return "low";
  if (budgetTokens <= 8192) return "medium";
  return "high";
}

export function getAnthropicRequestedReasoningEffort(
  payload: AnthropicMessagesPayload,
): ResponsesReasoningEffort | null {
  if (payload.output_config?.effort) {
    const effort = payload.output_config.effort;
    if (effort === "max") return "high";
    if (effort === "low" || effort === "medium" || effort === "high") {
      return effort;
    }
  }

  const budgetEffort = mapThinkingBudgetToReasoningEffort(
    payload.thinking?.budget_tokens,
  );
  if (budgetEffort) return budgetEffort;

  if (payload.thinking?.type === "enabled") return "high";
  return null;
}

export function pickSupportedReasoningEffort(
  requested: ResponsesReasoningEffort | null,
  supported: readonly ResponsesReasoningEffort[],
): ResponsesReasoningEffort | null {
  if (!requested || supported.length === 0) return null;
  if (supported.includes(requested)) return requested;

  const requestedRank = REASONING_RANK[requested];
  const lower = [...supported]
    .filter((effort) => REASONING_RANK[effort] < requestedRank)
    .sort((a, b) => REASONING_RANK[b] - REASONING_RANK[a]);
  if (lower.length > 0) return lower[0];

  const higher = [...supported]
    .filter((effort) => REASONING_RANK[effort] > requestedRank)
    .sort((a, b) => REASONING_RANK[a] - REASONING_RANK[b]);
  return higher[0] ?? null;
}

export function isResponsesReasoningEffort(
  value: unknown,
): value is ResponsesReasoningEffort {
  return typeof value === "string" &&
    RESPONSES_REASONING_EFFORTS.includes(value as ResponsesReasoningEffort);
}

export function makeResponsesReasoningId(index: number): string {
  return `rs_${index}`;
}
