import type { MessagesPayload } from "../../../../../lib/messages-types.ts";
import { stripMessagesBillingAttribution } from "./strip-billing-attribution.ts";
import { stripMessagesCacheControlScope } from "./strip-cache-control-scope.ts";
import { stripUnsupportedMessagesTools } from "./strip-unsupported-tools.ts";

export const normalizeMessagesRequest = (
  payload: MessagesPayload,
): MessagesPayload => {
  stripUnsupportedMessagesTools(payload);
  stripMessagesBillingAttribution(payload);
  stripMessagesCacheControlScope(payload);

  return payload;
};
