import type { ResponsesResult } from "../../../../../lib/responses-types.ts";
import { reassembleResponsesEvents } from "../../../../../lib/event-reassemble.ts";
import { protocolEventsUntilTerminal } from "../../../shared/stream/protocol-algebra.ts";
import { type ProtocolFrame } from "../../../shared/stream/types.ts";
import {
  responsesSourceStreamAlgebra,
  type SourceResponseStreamEvent,
} from "./protocol.ts";

export const collectResponsesProtocolEventsToResult = async (
  frames: AsyncIterable<ProtocolFrame<SourceResponseStreamEvent>>,
): Promise<ResponsesResult> => {
  return await reassembleResponsesEvents(
    protocolEventsUntilTerminal(frames, responsesSourceStreamAlgebra),
  );
};
