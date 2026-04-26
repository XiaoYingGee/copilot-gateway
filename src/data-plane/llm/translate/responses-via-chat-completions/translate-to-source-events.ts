import type {
  ChatCompletionChunk,
} from "../../../../lib/chat-completions-types.ts";
import {
  createChatCompletionsToResponsesStreamState,
  flushChatCompletionsToResponsesEvents,
  translateChatCompletionsChunkToResponsesEvents,
} from "../../../../lib/translate/chat-completions-to-responses.ts";
import { protocolEventsUntilTerminal } from "../../shared/stream/protocol-algebra.ts";
import { eventFrame, type ProtocolFrame } from "../../shared/stream/types.ts";
import type { SourceResponseStreamEvent } from "../../sources/responses/events/protocol.ts";
import { upstreamChatCompletionStreamAlgebra } from "../upstream-protocol.ts";

export const translateToSourceEvents = async function* (
  frames: AsyncIterable<ProtocolFrame<ChatCompletionChunk>>,
): AsyncGenerator<ProtocolFrame<SourceResponseStreamEvent>> {
  const state = createChatCompletionsToResponsesStreamState();

  for await (
    const chunk of protocolEventsUntilTerminal(
      frames,
      upstreamChatCompletionStreamAlgebra,
    )
  ) {
    for (
      const event of translateChatCompletionsChunkToResponsesEvents(
        chunk,
        state,
      )
    ) {
      yield eventFrame(event);
    }
  }

  for (const event of flushChatCompletionsToResponsesEvents(state)) {
    yield eventFrame(event);
  }
};
