import type { AnthropicMessagesPayload } from "../../../lib/anthropic-types.ts";
import { translateAnthropicToResponses } from "../../../lib/translate/responses.ts";

export const buildTargetRequest = (payload: AnthropicMessagesPayload) =>
  translateAnthropicToResponses(payload);
