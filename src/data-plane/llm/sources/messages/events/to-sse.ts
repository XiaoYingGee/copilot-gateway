import type { MessagesStreamEventData } from "../../../../../lib/messages-types.ts";
import {
  type ProtocolFrame,
  type SseFrame,
  sseFrame,
} from "../../../shared/stream/types.ts";

export const messagesProtocolEventToSSEFrame = (
  frame: ProtocolFrame<MessagesStreamEventData>,
): SseFrame | null =>
  frame.type === "done"
    ? null
    : sseFrame(JSON.stringify(frame.event), frame.event.type);

export const messagesProtocolEventsToSSEFrames = async function* (
  frames: AsyncIterable<ProtocolFrame<MessagesStreamEventData>>,
): AsyncGenerator<SseFrame> {
  let sawTerminal = false;

  for await (const frame of frames) {
    if (frame.type === "event") {
      sawTerminal ||= frame.event.type === "message_stop" ||
        frame.event.type === "error";
    }

    const sse = messagesProtocolEventToSSEFrame(frame);
    if (sse) yield sse;
  }

  if (!sawTerminal) {
    throw new Error("Messages stream ended without a message_stop event.");
  }
};
