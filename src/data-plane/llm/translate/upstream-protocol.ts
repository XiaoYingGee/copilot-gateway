import type { ChatCompletionChunk } from "../../../lib/chat-completions-types.ts";
import type { MessagesStreamEventData } from "../../../lib/messages-types.ts";
import type { ResponseStreamEvent } from "../../../lib/responses-types.ts";
import type { ProtocolTerminalAlgebra } from "../shared/stream/protocol-algebra.ts";
import {
  isMessagesTerminalEvent,
  isResponsesTerminalEvent,
} from "../shared/stream/terminal-events.ts";

export type UpstreamResponseStreamEvent = ResponseStreamEvent & {
  sequence_number?: number;
};

export const upstreamChatCompletionStreamAlgebra = {
  doneTerminates: true,
  missingTerminalMessage:
    "Upstream Chat Completions stream ended without a DONE sentinel.",
} satisfies ProtocolTerminalAlgebra<ChatCompletionChunk>;

export const upstreamMessagesStreamAlgebra = {
  isTerminalEvent: isMessagesTerminalEvent,
  missingTerminalMessage:
    "Upstream Messages stream ended without a message_stop event.",
} satisfies ProtocolTerminalAlgebra<MessagesStreamEventData>;

export const upstreamResponsesStreamAlgebra = {
  isTerminalEvent: isResponsesTerminalEvent,
  missingTerminalMessage:
    "Upstream Responses stream ended without a terminal event.",
} satisfies ProtocolTerminalAlgebra<UpstreamResponseStreamEvent>;
