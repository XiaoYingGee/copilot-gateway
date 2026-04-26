import type { MessagesStreamEventData } from "../../../../lib/messages-types.ts";
import type { ResponseStreamEvent } from "../../../../lib/responses-types.ts";

export const isMessagesTerminalEvent = (
  event: Pick<MessagesStreamEventData, "type">,
): boolean => event.type === "message_stop" || event.type === "error";

export const isResponsesTerminalEvent = (
  event: Pick<ResponseStreamEvent, "type">,
): boolean =>
  event.type === "response.completed" ||
  event.type === "response.incomplete" ||
  event.type === "response.failed" ||
  event.type === "error";
