import type {
  ChatCompletionChunk,
} from "../../../../lib/chat-completions-types.ts";
import type { MessagesStreamEventData } from "../../../../lib/messages-types.ts";
import {
  createChatCompletionsToMessagesStreamState,
  flushChatCompletionsToMessagesEvents,
  translateChatCompletionsChunkToMessagesEvents,
} from "../../../../lib/translate/chat-completions-to-messages-stream.ts";
import { protocolEventsUntilTerminal } from "../../shared/stream/protocol-algebra.ts";
import { eventFrame, type ProtocolFrame } from "../../shared/stream/types.ts";
import { upstreamChatCompletionStreamAlgebra } from "../upstream-protocol.ts";

export const translateToSourceEvents = async function* (
  frames: AsyncIterable<ProtocolFrame<ChatCompletionChunk>>,
): AsyncGenerator<ProtocolFrame<MessagesStreamEventData>> {
  const state = createChatCompletionsToMessagesStreamState();

  for await (
    const chunk of protocolEventsUntilTerminal(
      frames,
      upstreamChatCompletionStreamAlgebra,
    )
  ) {
    for (
      const event of translateChatCompletionsChunkToMessagesEvents(
        chunk,
        state,
      )
    ) {
      yield eventFrame(event);
    }
  }

  for (const event of flushChatCompletionsToMessagesEvents(state)) {
    yield eventFrame(event);
  }
};
