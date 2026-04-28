import type { MessagesPayload } from "../../../../lib/messages-types.ts";
import type { ModelCapabilities } from "../../shared/models/get-model-capabilities.ts";
import type { MessagesPlan } from "../../shared/types/plan.ts";

const hasVision = (payload: MessagesPayload): boolean =>
  payload.messages.some((message) =>
    Array.isArray(message.content) &&
    message.content.some((block) => block.type === "image")
  );

const getInitiator = (payload: MessagesPayload): "user" | "agent" => {
  const lastMessage = payload.messages[payload.messages.length - 1];
  if (!lastMessage || lastMessage.role !== "user") return "agent";
  if (!Array.isArray(lastMessage.content)) return "user";

  return lastMessage.content.some((block) => block.type !== "tool_result")
    ? "user"
    : "agent";
};

export const planMessagesRequest = (
  payload: MessagesPayload,
  capabilities: ModelCapabilities,
  rawBeta: string | undefined,
): MessagesPlan => {
  const wantsStream = payload.stream === true;
  const fetchOptions = {
    vision: hasVision(payload),
    initiator: getInitiator(payload),
  };

  // Messages-origin routing prefers native Messages, then Responses, and only
  // uses Chat Completions as the last fallback.
  if (capabilities.supportsMessages) {
    return {
      source: "messages",
      target: "messages",
      wantsStream,
      fetchOptions,
      rawBeta,
    };
  }

  if (capabilities.supportsResponses) {
    return {
      source: "messages",
      target: "responses",
      wantsStream,
      fetchOptions,
    };
  }

  return {
    source: "messages",
    target: "chat-completions",
    wantsStream,
    fetchOptions,
  };
};
