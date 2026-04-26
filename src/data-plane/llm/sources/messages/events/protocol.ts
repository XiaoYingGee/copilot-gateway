import type { MessagesStreamEventData } from "../../../../../lib/messages-types.ts";
import type { ProtocolTerminalAlgebra } from "../../../shared/stream/protocol-algebra.ts";
import { isMessagesTerminalEvent } from "../../../shared/stream/terminal-events.ts";

export const messagesSourceStreamAlgebra = {
  isTerminalEvent: isMessagesTerminalEvent,
  missingTerminalMessage: "Messages stream ended without a message_stop event.",
} satisfies ProtocolTerminalAlgebra<MessagesStreamEventData>;
