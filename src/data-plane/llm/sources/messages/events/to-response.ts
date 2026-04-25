import type {
  MessagesResponse,
  MessagesStreamEventData,
} from "../../../../../lib/messages-types.ts";
import { reassembleMessagesEvents } from "../../../../../lib/event-reassemble.ts";
import { type ProtocolFrame } from "../../../shared/stream/types.ts";

export const collectMessagesProtocolEventsToResponse = async (
  frames: AsyncIterable<ProtocolFrame<MessagesStreamEventData>>,
): Promise<MessagesResponse> => {
  let sawMessageStop = false;

  const events = async function* (): AsyncGenerator<MessagesStreamEventData> {
    for await (const frame of frames) {
      if (frame.type === "done") continue;
      if (frame.event.type === "message_stop") sawMessageStop = true;
      yield frame.event;
    }
  };

  const response = await reassembleMessagesEvents(events());
  if (!sawMessageStop) {
    throw new Error("Messages stream ended without a message_stop event.");
  }

  return response;
};
