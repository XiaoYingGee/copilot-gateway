import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
} from "../../../../../lib/chat-completions-types.ts";
import { reassembleChatCompletionChunks } from "../../../../../lib/event-reassemble.ts";
import { protocolEventsUntilTerminal } from "../../../shared/stream/protocol-algebra.ts";
import { type ProtocolFrame } from "../../../shared/stream/types.ts";
import { chatCompletionSourceStreamAlgebra } from "./protocol.ts";

export const collectChatProtocolEventsToCompletion = async (
  frames: AsyncIterable<ProtocolFrame<ChatCompletionChunk>>,
): Promise<ChatCompletionResponse> => {
  return await reassembleChatCompletionChunks(
    protocolEventsUntilTerminal(frames, chatCompletionSourceStreamAlgebra),
  );
};
