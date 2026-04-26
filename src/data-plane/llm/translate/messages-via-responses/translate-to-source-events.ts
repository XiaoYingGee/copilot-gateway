import type { MessagesStreamEventData } from "../../../../lib/messages-types.ts";
import type { ResponsesResult } from "../../../../lib/responses-types.ts";
import { translateResponsesToMessagesResponse } from "../../../../lib/translate/responses-to-messages.ts";
import {
  createResponsesToMessagesStreamState,
  translateResponsesStreamEventToMessagesEvents,
} from "../../../../lib/translate/responses-to-messages-stream.ts";
import {
  type EventFrame,
  eventFrame,
  type ProtocolFrame,
} from "../../shared/stream/types.ts";
import { protocolEventsUntilTerminal } from "../../shared/stream/protocol-algebra.ts";
import { messagesResultToEvents } from "../../targets/messages/events/from-result.ts";
import {
  upstreamResponsesStreamAlgebra,
  type UpstreamResponseStreamEvent,
} from "../upstream-protocol.ts";

export const translateToSourceEvents = async function* (
  frames: AsyncIterable<ProtocolFrame<UpstreamResponseStreamEvent>>,
): AsyncGenerator<ProtocolFrame<MessagesStreamEventData>> {
  const state = createResponsesToMessagesStreamState();
  let sawStructuredOutput = false;
  let streamingCommitted = false;
  const pendingFrames: Array<EventFrame<MessagesStreamEventData>> = [];

  for await (
    const event of protocolEventsUntilTerminal(
      frames,
      upstreamResponsesStreamAlgebra,
    )
  ) {
    if (
      event.type === "response.output_item.added" ||
      event.type === "response.output_item.done" ||
      event.type === "response.reasoning_summary_text.delta" ||
      event.type === "response.reasoning_summary_text.done" ||
      event.type === "response.output_text.delta" ||
      event.type === "response.output_text.done" ||
      event.type === "response.function_call_arguments.delta" ||
      event.type === "response.function_call_arguments.done"
    ) {
      sawStructuredOutput = true;
      if (!streamingCommitted) {
        streamingCommitted = true;
        for (const pending of pendingFrames) yield pending;
        pendingFrames.length = 0;
      }
    }

    if (
      !streamingCommitted &&
      !sawStructuredOutput &&
      (event.type === "response.completed" ||
        event.type === "response.incomplete")
    ) {
      pendingFrames.length = 0;
      yield* messagesResultToEvents(
        translateResponsesToMessagesResponse(event.response as ResponsesResult),
      );
      continue;
    }

    for (
      const translated of translateResponsesStreamEventToMessagesEvents(
        event,
        state,
      )
    ) {
      const translatedFrame = eventFrame(translated);
      if (streamingCommitted) {
        yield translatedFrame;
      } else {
        pendingFrames.push(translatedFrame);
      }
    }
  }

  if (!streamingCommitted) {
    for (const pending of pendingFrames) yield pending;
  }
};
