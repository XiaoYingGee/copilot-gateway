import { chatCompletionsErrorPayloadMessage } from "../../../../../lib/chat-completions-errors.ts";
import type { ChatCompletionChunk } from "../../../../../lib/chat-completions-types.ts";
import type { ProtocolTerminalAlgebra } from "../../../shared/stream/protocol-algebra.ts";

export const chatCompletionSourceStreamAlgebra = {
  doneTerminates: true,
  isTerminalEvent: (event: ChatCompletionChunk) =>
    chatCompletionsErrorPayloadMessage(event) !== null,
  missingTerminalMessage:
    "Chat Completions stream ended without a DONE sentinel.",
} satisfies ProtocolTerminalAlgebra<ChatCompletionChunk>;
