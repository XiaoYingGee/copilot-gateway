import type { ChatCompletionsPayload } from "../../../lib/openai-types.ts";
import { translateChatToResponses } from "../../../lib/translate/chat-to-responses.ts";

export const buildTargetRequest = (payload: ChatCompletionsPayload) =>
  translateChatToResponses(payload);
