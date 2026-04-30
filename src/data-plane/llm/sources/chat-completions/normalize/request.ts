import type { ChatCompletionsPayload } from "../../../../../lib/chat-completions-types.ts";

export const normalizeChatRequest = (
  payload: ChatCompletionsPayload,
): ChatCompletionsPayload => {
  return payload;
};
