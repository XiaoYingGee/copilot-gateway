import {
  MESSAGES_THINKING_PLACEHOLDER,
  type MessagesStreamEventData,
} from "../messages-types.ts";
import type {
  ResponsesResult,
  ResponseStreamEvent,
} from "../responses-types.ts";
import { translateResponsesToMessagesResponse } from "./responses-to-messages.ts";
import { checkWhitespaceOverflow } from "./utils.ts";

type ResponseCreatedEvent = Extract<
  ResponseStreamEvent,
  { type: "response.created" }
>;

type ResponseOutputItemAddedEvent = Extract<
  ResponseStreamEvent,
  { type: "response.output_item.added" }
>;

type ResponseOutputItemDoneEvent = Extract<
  ResponseStreamEvent,
  { type: "response.output_item.done" }
>;

type ResponseReasoningSummaryTextDeltaEvent = Extract<
  ResponseStreamEvent,
  { type: "response.reasoning_summary_text.delta" }
>;

type ResponseReasoningSummaryTextDoneEvent = Extract<
  ResponseStreamEvent,
  { type: "response.reasoning_summary_text.done" }
>;

type ResponseOutputTextDeltaEvent = Extract<
  ResponseStreamEvent,
  { type: "response.output_text.delta" }
>;

type ResponseOutputTextDoneEvent = Extract<
  ResponseStreamEvent,
  { type: "response.output_text.done" }
>;

type ResponseFunctionCallArgumentsDeltaEvent = Extract<
  ResponseStreamEvent,
  { type: "response.function_call_arguments.delta" }
>;

type ResponseFunctionCallArgumentsDoneEvent = Extract<
  ResponseStreamEvent,
  { type: "response.function_call_arguments.done" }
>;

type ResponseCompletedEvent = Extract<
  ResponseStreamEvent,
  { type: "response.completed" }
>;

type ResponseIncompleteEvent = Extract<
  ResponseStreamEvent,
  { type: "response.incomplete" }
>;

type ResponseFailedEvent = Extract<
  ResponseStreamEvent,
  { type: "response.failed" }
>;

type ErrorEvent = Extract<ResponseStreamEvent, { type: "error" }>;

interface ResponsesToMessagesStreamState {
  messageCompleted: boolean;
  nextBlockIndex: number;
  blockIndexByKey: Map<string, number>;
  openBlocks: Set<number>;
  blockHasDelta: Set<number>;
  functionCallState: Map<number, {
    blockIndex: number;
    toolCallId: string;
    name: string;
    consecutiveWhitespace: number;
  }>;
}

type ContentBlockInit =
  | { type: "text"; text: "" }
  | { type: "thinking"; thinking: "" };

const openBlock = (
  state: ResponsesToMessagesStreamState,
  key: string,
  contentBlock: ContentBlockInit,
  events: MessagesStreamEventData[],
): number => {
  let blockIndex = state.blockIndexByKey.get(key);

  if (blockIndex === undefined) {
    blockIndex = state.nextBlockIndex++;
    state.blockIndexByKey.set(key, blockIndex);
  }

  if (!state.openBlocks.has(blockIndex)) {
    closeOpenBlocks(state, events);
    events.push({
      type: "content_block_start",
      index: blockIndex,
      content_block: contentBlock,
    });
    state.openBlocks.add(blockIndex);
  }

  return blockIndex;
};

const openTextBlock = (
  state: ResponsesToMessagesStreamState,
  outputIndex: number,
  contentIndex: number,
  events: MessagesStreamEventData[],
): number =>
  openBlock(
    state,
    `${outputIndex}:${contentIndex}`,
    { type: "text", text: "" },
    events,
  );

const openThinkingBlock = (
  state: ResponsesToMessagesStreamState,
  outputIndex: number,
  events: MessagesStreamEventData[],
): number =>
  openBlock(
    state,
    `${outputIndex}:0`,
    { type: "thinking", thinking: "" },
    events,
  );

const closeOpenBlocks = (
  state: ResponsesToMessagesStreamState,
  events: MessagesStreamEventData[],
): void => {
  for (const blockIndex of state.openBlocks) {
    events.push({ type: "content_block_stop", index: blockIndex });
  }

  state.openBlocks.clear();
  state.blockHasDelta.clear();
};

const closeAllBlocks = (
  state: ResponsesToMessagesStreamState,
  events: MessagesStreamEventData[],
): void => {
  closeOpenBlocks(state, events);
  state.functionCallState.clear();
};

const handleResponseCreated = (
  response: ResponsesResult,
): MessagesStreamEventData[] => {
  const cachedTokens = response.usage?.input_tokens_details?.cached_tokens;

  return [{
    type: "message_start",
    message: {
      id: response.id,
      type: "message",
      role: "assistant",
      content: [],
      model: response.model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: (response.usage?.input_tokens ?? 0) - (cachedTokens ?? 0),
        output_tokens: 0,
        ...(cachedTokens !== undefined
          ? { cache_read_input_tokens: cachedTokens }
          : {}),
      },
    },
  }];
};

const handleOutputItemAdded = (
  event: ResponseOutputItemAddedEvent,
  state: ResponsesToMessagesStreamState,
): MessagesStreamEventData[] => {
  if (event.item.type !== "function_call") return [];

  const blockIndex = state.nextBlockIndex++;
  const toolCallId = event.item.call_id ?? `tool_${blockIndex}`;
  const name = event.item.name ?? "function";

  state.functionCallState.set(event.output_index, {
    blockIndex,
    toolCallId,
    name,
    consecutiveWhitespace: 0,
  });

  const events: MessagesStreamEventData[] = [];
  closeOpenBlocks(state, events);
  events.push({
    type: "content_block_start",
    index: blockIndex,
    content_block: { type: "tool_use", id: toolCallId, name, input: {} },
  });
  state.openBlocks.add(blockIndex);

  if (event.item.arguments.length > 0) {
    events.push({
      type: "content_block_delta",
      index: blockIndex,
      delta: { type: "input_json_delta", partial_json: event.item.arguments },
    });
    state.blockHasDelta.add(blockIndex);
  }

  return events;
};

const handleOutputItemDone = (
  event: ResponseOutputItemDoneEvent,
  state: ResponsesToMessagesStreamState,
): MessagesStreamEventData[] => {
  if (event.item.type !== "reasoning") return [];

  const events: MessagesStreamEventData[] = [];
  const blockIndex = openThinkingBlock(state, event.output_index, events);

  if (event.item.summary.length === 0) {
    events.push({
      type: "content_block_delta",
      index: blockIndex,
      delta: {
        type: "thinking_delta",
        thinking: MESSAGES_THINKING_PLACEHOLDER,
      },
    });
  }

  events.push({
    type: "content_block_delta",
    index: blockIndex,
    delta: {
      type: "signature_delta",
      signature: event.item.encrypted_content ?? "",
    },
  });
  state.blockHasDelta.add(blockIndex);
  return events;
};

const handleThinkingDelta = (
  event: ResponseReasoningSummaryTextDeltaEvent,
  state: ResponsesToMessagesStreamState,
): MessagesStreamEventData[] => {
  const events: MessagesStreamEventData[] = [];
  const blockIndex = openThinkingBlock(state, event.output_index, events);
  events.push({
    type: "content_block_delta",
    index: blockIndex,
    delta: { type: "thinking_delta", thinking: event.delta },
  });
  state.blockHasDelta.add(blockIndex);
  return events;
};

const handleThinkingDone = (
  event: ResponseReasoningSummaryTextDoneEvent,
  state: ResponsesToMessagesStreamState,
): MessagesStreamEventData[] => {
  const events: MessagesStreamEventData[] = [];
  const blockIndex = openThinkingBlock(state, event.output_index, events);

  if (event.text && !state.blockHasDelta.has(blockIndex)) {
    events.push({
      type: "content_block_delta",
      index: blockIndex,
      delta: { type: "thinking_delta", thinking: event.text },
    });
  }

  return events;
};

const handleTextDelta = (
  event: ResponseOutputTextDeltaEvent,
  state: ResponsesToMessagesStreamState,
): MessagesStreamEventData[] => {
  if (!event.delta) return [];

  const events: MessagesStreamEventData[] = [];
  const blockIndex = openTextBlock(
    state,
    event.output_index,
    event.content_index,
    events,
  );
  events.push({
    type: "content_block_delta",
    index: blockIndex,
    delta: { type: "text_delta", text: event.delta },
  });
  state.blockHasDelta.add(blockIndex);
  return events;
};

const handleTextDone = (
  event: ResponseOutputTextDoneEvent,
  state: ResponsesToMessagesStreamState,
): MessagesStreamEventData[] => {
  const events: MessagesStreamEventData[] = [];
  const blockIndex = openTextBlock(
    state,
    event.output_index,
    event.content_index,
    events,
  );

  if (event.text && !state.blockHasDelta.has(blockIndex)) {
    events.push({
      type: "content_block_delta",
      index: blockIndex,
      delta: { type: "text_delta", text: event.text },
    });
  }

  return events;
};

const handleFunctionArgumentsDelta = (
  event: ResponseFunctionCallArgumentsDeltaEvent,
  state: ResponsesToMessagesStreamState,
): MessagesStreamEventData[] => {
  if (!event.delta) return [];

  const functionCallState = state.functionCallState.get(event.output_index);
  if (!functionCallState) return [];

  const whitespace = checkWhitespaceOverflow(
    event.delta,
    functionCallState.consecutiveWhitespace,
  );
  functionCallState.consecutiveWhitespace = whitespace.count;

  if (whitespace.exceeded) {
    const events: MessagesStreamEventData[] = [];
    console.warn(
      "Infinite whitespace in Responses function call args, aborting",
    );
    closeAllBlocks(state, events);
    state.messageCompleted = true;
    events.push({
      type: "error",
      error: {
        type: "api_error",
        message: "Tool call arguments contained excessive whitespace.",
      },
    });
    return events;
  }

  state.blockHasDelta.add(functionCallState.blockIndex);

  return [{
    type: "content_block_delta",
    index: functionCallState.blockIndex,
    delta: { type: "input_json_delta", partial_json: event.delta },
  }];
};

const handleFunctionArgumentsDone = (
  event: ResponseFunctionCallArgumentsDoneEvent,
  state: ResponsesToMessagesStreamState,
): MessagesStreamEventData[] => {
  const functionCallState = state.functionCallState.get(event.output_index);
  if (!functionCallState) return [];

  state.functionCallState.delete(event.output_index);

  if (
    !event.arguments || state.blockHasDelta.has(functionCallState.blockIndex)
  ) {
    return [];
  }

  return [{
    type: "content_block_delta",
    index: functionCallState.blockIndex,
    delta: { type: "input_json_delta", partial_json: event.arguments },
  }];
};

const handleCompleted = (
  response: ResponsesResult,
  state: ResponsesToMessagesStreamState,
): MessagesStreamEventData[] => {
  const events: MessagesStreamEventData[] = [];
  closeAllBlocks(state, events);

  const messagesResponse = translateResponsesToMessagesResponse(response);
  events.push(
    {
      type: "message_delta",
      delta: {
        stop_reason: messagesResponse.stop_reason,
        stop_sequence: messagesResponse.stop_sequence,
      },
      usage: messagesResponse.usage,
    },
    { type: "message_stop" },
  );
  state.messageCompleted = true;
  return events;
};

const handleFailed = (
  response: ResponsesResult,
  state: ResponsesToMessagesStreamState,
): MessagesStreamEventData[] => {
  const events: MessagesStreamEventData[] = [];
  closeAllBlocks(state, events);
  state.messageCompleted = true;
  events.push({
    type: "error",
    error: {
      type: "api_error",
      message: response.error?.message ??
        "Response failed due to unknown error.",
    },
  });
  return events;
};

const handleError = (
  event: ErrorEvent,
  state: ResponsesToMessagesStreamState,
): MessagesStreamEventData[] => {
  const events: MessagesStreamEventData[] = [];
  closeAllBlocks(state, events);
  state.messageCompleted = true;
  events.push({
    type: "error",
    error: {
      type: "api_error",
      message: typeof event.message === "string"
        ? event.message
        : "An unexpected error occurred during streaming.",
    },
  });
  return events;
};

export const createResponsesToMessagesStreamState =
  (): ResponsesToMessagesStreamState => ({
    messageCompleted: false,
    nextBlockIndex: 0,
    blockIndexByKey: new Map(),
    openBlocks: new Set(),
    blockHasDelta: new Set(),
    functionCallState: new Map(),
  });

export const translateResponsesStreamEventToMessagesEvents = (
  event: ResponseStreamEvent,
  state: ResponsesToMessagesStreamState,
): MessagesStreamEventData[] => {
  if (state.messageCompleted) return [];

  switch (event.type) {
    case "response.created":
      return handleResponseCreated((event as ResponseCreatedEvent).response);
    case "response.output_item.added":
      return handleOutputItemAdded(
        event as ResponseOutputItemAddedEvent,
        state,
      );
    case "response.output_item.done":
      return handleOutputItemDone(event as ResponseOutputItemDoneEvent, state);
    case "response.reasoning_summary_text.delta":
      return handleThinkingDelta(
        event as ResponseReasoningSummaryTextDeltaEvent,
        state,
      );
    case "response.reasoning_summary_text.done":
      return handleThinkingDone(
        event as ResponseReasoningSummaryTextDoneEvent,
        state,
      );
    case "response.output_text.delta":
      return handleTextDelta(event as ResponseOutputTextDeltaEvent, state);
    case "response.output_text.done":
      return handleTextDone(event as ResponseOutputTextDoneEvent, state);
    case "response.function_call_arguments.delta":
      return handleFunctionArgumentsDelta(
        event as ResponseFunctionCallArgumentsDeltaEvent,
        state,
      );
    case "response.function_call_arguments.done":
      return handleFunctionArgumentsDone(
        event as ResponseFunctionCallArgumentsDoneEvent,
        state,
      );
    case "response.completed":
      return handleCompleted((event as ResponseCompletedEvent).response, state);
    case "response.incomplete":
      return handleCompleted(
        (event as ResponseIncompleteEvent).response,
        state,
      );
    case "response.failed":
      return handleFailed((event as ResponseFailedEvent).response, state);
    case "error":
      return handleError(event as ErrorEvent, state);
    case "ping":
      return [{ type: "ping" }];
    default:
      return [];
  }
};
