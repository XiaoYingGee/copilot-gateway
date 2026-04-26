import type {
  MessagesStreamEventData,
} from "../../../../lib/messages-types.ts";
import {
  createMessagesToResponsesStreamState,
  translateMessagesEventToResponsesEvents,
} from "../../../../lib/translate/messages-to-responses-stream.ts";
import { protocolEventsUntilTerminal } from "../../shared/stream/protocol-algebra.ts";
import { eventFrame, type ProtocolFrame } from "../../shared/stream/types.ts";
import type { SourceResponseStreamEvent } from "../../sources/responses/events/protocol.ts";
import { upstreamMessagesStreamAlgebra } from "../upstream-protocol.ts";

export const translateToSourceEvents = async function* (
  frames: AsyncIterable<ProtocolFrame<MessagesStreamEventData>>,
  responseId: string,
  model: string,
): AsyncGenerator<ProtocolFrame<SourceResponseStreamEvent>> {
  const state = createMessagesToResponsesStreamState(responseId, model);

  for await (
    const event of protocolEventsUntilTerminal(
      frames,
      upstreamMessagesStreamAlgebra,
    )
  ) {
    for (
      const translated of translateMessagesEventToResponsesEvents(
        event,
        state,
      )
    ) {
      yield eventFrame(translated);
    }
  }
};
