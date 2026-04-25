import type {
  ChatCompletionChunk,
} from "../../../../lib/chat-completions-types.ts";
import {
  createChatCompletionsToResponsesStreamState,
  flushChatCompletionsToResponsesEvents,
  translateChatCompletionsChunkToResponsesEvents,
} from "../../../../lib/translate/chat-completions-to-responses.ts";
import { eventFrame, type ProtocolFrame } from "../../shared/stream/types.ts";
import type { SourceResponseStreamEvent } from "../../sources/responses/events/to-sse.ts";

export const translateToSourceEvents = async function* (
  frames: AsyncIterable<ProtocolFrame<ChatCompletionChunk>>,
): AsyncGenerator<ProtocolFrame<SourceResponseStreamEvent>> {
  const state = createChatCompletionsToResponsesStreamState();
  let sawDone = false;

  for await (const frame of frames) {
    if (frame.type === "done") {
      sawDone = true;
      break;
    }

    for (
      const event of translateChatCompletionsChunkToResponsesEvents(
        frame.event,
        state,
      )
    ) {
      yield eventFrame(event);
    }
  }

  if (!sawDone) {
    throw new Error(
      "Upstream Chat Completions stream ended without a DONE sentinel.",
    );
  }

  for (const event of flushChatCompletionsToResponsesEvents(state)) {
    yield eventFrame(event);
  }
};
