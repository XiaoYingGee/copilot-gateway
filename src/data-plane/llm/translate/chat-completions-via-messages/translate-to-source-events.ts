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
import { protocolEventsUntilTerminal } from "../../shared/stream/protocol-algebra.ts";
import { upstreamMessagesStreamAlgebra } from "../upstream-protocol.ts";

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

  for await (
    const event of protocolEventsUntilTerminal(
      frames,
      upstreamMessagesStreamAlgebra,
    )
  ) {
    throwOnMessagesFatalEvent(event);

    const translated = translateMessagesEventToChatCompletionsChunks(
      event,
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
