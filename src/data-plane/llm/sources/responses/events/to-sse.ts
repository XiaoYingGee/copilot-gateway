import {
  type ProtocolFrame,
  type SseFrame,
  sseFrame,
} from "../../../shared/stream/types.ts";
import { protocolEventsUntilTerminal } from "../../../shared/stream/protocol-algebra.ts";
import {
  responsesSourceStreamAlgebra,
  type SourceResponseStreamEvent,
} from "./protocol.ts";

export const responsesProtocolEventToSSEFrame = (
  event: SourceResponseStreamEvent,
): SseFrame => sseFrame(JSON.stringify(event), event.type);

export const responsesProtocolEventsToSSEFrames = async function* (
  frames: AsyncIterable<ProtocolFrame<SourceResponseStreamEvent>>,
): AsyncGenerator<SseFrame> {
  for await (
    const event of protocolEventsUntilTerminal(
      frames,
      responsesSourceStreamAlgebra,
    )
  ) {
    yield responsesProtocolEventToSSEFrame(event);
  }
};
