import type {
  ChatCompletionChunk,
} from "../../../../lib/chat-completions-types.ts";
import type { MessagesStreamEventData } from "../../../../lib/messages-types.ts";
import {
  createChatCompletionsToMessagesStreamState,
  flushChatCompletionsToMessagesEvents,
  translateChatCompletionsChunkToMessagesEvents,
} from "../../../../lib/translate/chat-completions-to-messages-stream.ts";
import { eventFrame, type ProtocolFrame } from "../../shared/stream/types.ts";

export const translateToSourceEvents = async function* (
  frames: AsyncIterable<ProtocolFrame<ChatCompletionChunk>>,
): AsyncGenerator<ProtocolFrame<MessagesStreamEventData>> {
  const state = createChatCompletionsToMessagesStreamState();
  let sawDone = false;

  for await (const frame of frames) {
    if (frame.type === "done") {
      sawDone = true;
      break;
    }

    for (
      const event of translateChatCompletionsChunkToMessagesEvents(
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

  for (const event of flushChatCompletionsToMessagesEvents(state)) {
    yield eventFrame(event);
  }
};
