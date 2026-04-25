import type { ResponsesResult } from "../../../../../lib/responses-types.ts";
import { reassembleResponsesEvents } from "../../../../../lib/event-reassemble.ts";
import {
  type ProtocolFrame,
  protocolFramesToEvents,
} from "../../../shared/stream/types.ts";
import { type SourceResponseStreamEvent } from "./to-sse.ts";

export const collectResponsesProtocolEventsToResult = async (
  frames: AsyncIterable<ProtocolFrame<SourceResponseStreamEvent>>,
): Promise<ResponsesResult> => {
  return await reassembleResponsesEvents(protocolFramesToEvents(frames));
};
