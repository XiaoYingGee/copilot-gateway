import type { ResponseStreamEvent } from "../../../../../lib/responses-types.ts";
import {
  type ProtocolFrame,
  type SseFrame,
  sseFrame,
} from "../../../shared/stream/types.ts";

export type SourceResponseStreamEvent = ResponseStreamEvent & {
  sequence_number?: number;
};

export const responsesProtocolEventToSSEFrame = (
  frame: ProtocolFrame<SourceResponseStreamEvent>,
): SseFrame | null =>
  frame.type === "done"
    ? null
    : sseFrame(JSON.stringify(frame.event), frame.event.type);

export const responsesProtocolEventsToSSEFrames = async function* (
  frames: AsyncIterable<ProtocolFrame<SourceResponseStreamEvent>>,
): AsyncGenerator<SseFrame> {
  let sawTerminal = false;

  for await (const frame of frames) {
    if (frame.type === "event") {
      sawTerminal ||= frame.event.type === "response.completed" ||
        frame.event.type === "response.incomplete" ||
        frame.event.type === "response.failed" ||
        frame.event.type === "error";
    }

    const sse = responsesProtocolEventToSSEFrame(frame);
    if (sse) yield sse;
  }

  if (!sawTerminal) {
    throw new Error("Responses stream ended without a terminal event.");
  }
};
