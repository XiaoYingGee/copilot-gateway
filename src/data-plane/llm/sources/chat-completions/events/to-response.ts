import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
} from "../../../../../lib/chat-completions-types.ts";
import { reassembleChatCompletionChunks } from "../../../../../lib/event-reassemble.ts";
import { type ProtocolFrame } from "../../../shared/stream/types.ts";

export const collectChatProtocolEventsToCompletion = async (
  frames: AsyncIterable<ProtocolFrame<ChatCompletionChunk>>,
): Promise<ChatCompletionResponse> => {
  let sawDone = false;

  const chunks = async function* (): AsyncGenerator<ChatCompletionChunk> {
    for await (const frame of frames) {
      if (frame.type === "done") {
        sawDone = true;
        return;
      }

      yield frame.event;
    }
  };

  const response = await reassembleChatCompletionChunks(chunks());
  if (!sawDone) {
    throw new Error("Chat Completions stream ended without a DONE sentinel.");
  }

  return response;
};
