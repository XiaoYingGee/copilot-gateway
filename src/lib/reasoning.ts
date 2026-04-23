import type { AnthropicMessagesPayload } from "./anthropic-types.ts";

export function getAnthropicRequestedReasoningEffort(
  payload: AnthropicMessagesPayload,
): string | null {
  if (payload.output_config?.effort) return payload.output_config.effort;
  if (payload.thinking?.type === "disabled") return "none";
  return null;
}

export function makeResponsesReasoningId(index: number): string {
  return `rs_${index}`;
}
