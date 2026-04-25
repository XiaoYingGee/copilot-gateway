import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
} from "../../../../../lib/chat-completions-types.ts";
import {
  type DoneFrame,
  doneFrame,
  type EventFrame,
  eventFrame,
} from "../../../shared/stream/types.ts";

interface ChatCompletionResultToEventsOptions {
  includeUsageChunk?: boolean;
  onUsageChunk?: (usage: NonNullable<ChatCompletionResponse["usage"]>) => void;
}

const makeChunk = (
  response: ChatCompletionResponse,
  delta: Record<string, unknown>,
  finishReason: ChatCompletionChunk["choices"][number]["finish_reason"] = null,
): ChatCompletionChunk => ({
  id: response.id,
  object: "chat.completion.chunk",
  created: response.created,
  model: response.model,
  choices: [{
    index: 0,
    delta,
    finish_reason: finishReason,
  }],
});

export const chatCompletionResultToEvents = (
  response: ChatCompletionResponse,
  options: ChatCompletionResultToEventsOptions = {},
): Array<EventFrame<ChatCompletionChunk> | DoneFrame> => {
  const choice = response.choices[0];
  const includeUsageChunk = options.includeUsageChunk ?? true;
  const frames: Array<EventFrame<ChatCompletionChunk> | DoneFrame> = [
    eventFrame(makeChunk(response, { role: "assistant" })),
  ];

  if (
    choice?.message.reasoning_text !== undefined &&
    choice.message.reasoning_text !== null
  ) {
    frames.push(eventFrame(makeChunk(response, {
      reasoning_text: choice.message.reasoning_text,
    })));
  }

  if (
    choice?.message.reasoning_opaque !== undefined &&
    choice.message.reasoning_opaque !== null
  ) {
    frames.push(eventFrame(makeChunk(response, {
      reasoning_opaque: choice.message.reasoning_opaque,
    })));
  }

  if (choice?.message.reasoning_items?.length) {
    frames.push(eventFrame(makeChunk(response, {
      reasoning_items: choice.message.reasoning_items,
    })));
  }

  if (
    choice?.message.content !== undefined && choice.message.content !== null
  ) {
    frames.push(eventFrame(makeChunk(response, {
      content: choice.message.content,
    })));
  }

  choice?.message.tool_calls?.forEach((toolCall, index) => {
    frames.push(eventFrame(makeChunk(response, {
      tool_calls: [{
        index,
        id: toolCall.id,
        type: toolCall.type,
        function: toolCall.function,
      }],
    })));
  });

  frames.push(eventFrame(makeChunk(
    response,
    {},
    choice?.finish_reason ?? null,
  )));

  if (response.usage) options.onUsageChunk?.(response.usage);

  if (includeUsageChunk && response.usage) {
    frames.push(eventFrame({
      id: response.id,
      object: "chat.completion.chunk",
      created: response.created,
      model: response.model,
      choices: [],
      usage: response.usage,
    }));
  }

  frames.push(doneFrame());
  return frames;
};
