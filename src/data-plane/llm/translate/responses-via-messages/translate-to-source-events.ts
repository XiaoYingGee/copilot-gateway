import type {
  MessagesStreamEventData,
} from "../../../../lib/messages-types.ts";
import {
  createMessagesToResponsesStreamState,
  translateMessagesEventToResponsesEvents,
} from "../../../../lib/translate/messages-to-responses-stream.ts";
import { eventFrame, type ProtocolFrame } from "../../shared/stream/types.ts";
import type { SourceResponseStreamEvent } from "../../sources/responses/events/to-sse.ts";

export const translateToSourceEvents = async function* (
  frames: AsyncIterable<ProtocolFrame<MessagesStreamEventData>>,
  responseId: string,
  model: string,
): AsyncGenerator<ProtocolFrame<SourceResponseStreamEvent>> {
  const state = createMessagesToResponsesStreamState(responseId, model);

  for await (const frame of frames) {
    if (frame.type === "done") continue;

    for (
      const translated of translateMessagesEventToResponsesEvents(
        frame.event,
        state,
      )
    ) {
      yield eventFrame(translated);
    }
  }
};
