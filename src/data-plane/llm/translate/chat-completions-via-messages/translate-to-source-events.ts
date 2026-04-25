import type {
  MessagesStreamEventData,
} from "../../../../lib/messages-types.ts";
import type { ChatCompletionChunk } from "../../../../lib/chat-completions-types.ts";
import {
  createMessagesToChatCompletionsStreamState,
  translateMessagesEventToChatCompletionsChunks,
} from "../../../../lib/translate/messages-to-chat-completions-stream.ts";
import {
  doneFrame,
  eventFrame,
  type ProtocolFrame,
} from "../../shared/stream/types.ts";

const throwOnMessagesFatalEvent = (event: MessagesStreamEventData): void => {
  if (event.type !== "error") return;

  throw new Error(
    `Upstream Messages stream error: ${event.error.type}: ${event.error.message}`,
    { cause: event },
  );
};

export const translateToSourceEvents = async function* (
  frames: AsyncIterable<ProtocolFrame<MessagesStreamEventData>>,
): AsyncGenerator<ProtocolFrame<ChatCompletionChunk>> {
  const state = createMessagesToChatCompletionsStreamState();

  for await (const frame of frames) {
    if (frame.type === "done") continue;
    throwOnMessagesFatalEvent(frame.event);

    const translated = translateMessagesEventToChatCompletionsChunks(
      frame.event,
      state,
    );

    if (translated === "DONE") {
      yield doneFrame();
      continue;
    }

    for (const chunk of translated) {
      yield eventFrame(chunk);
    }
  }
};
