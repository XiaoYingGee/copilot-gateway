import type {
  MessagesResponse,
  MessagesStreamEventData,
} from "../../../../../lib/messages-types.ts";
import { reassembleMessagesEvents } from "../../../../../lib/event-reassemble.ts";
import { protocolEventsUntilTerminal } from "../../../shared/stream/protocol-algebra.ts";
import type { ProtocolFrame } from "../../../shared/stream/types.ts";
import { messagesSourceStreamAlgebra } from "./protocol.ts";

export const collectMessagesProtocolEventsToResponse = async (
  frames: AsyncIterable<ProtocolFrame<MessagesStreamEventData>>,
): Promise<MessagesResponse> => {
  return await reassembleMessagesEvents(
    protocolEventsUntilTerminal(frames, messagesSourceStreamAlgebra),
  );
};
