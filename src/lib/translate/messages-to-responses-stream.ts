import {
  MESSAGES_THINKING_PLACEHOLDER,
  type MessagesContentBlockDeltaEvent,
  type MessagesContentBlockStartEvent,
  type MessagesContentBlockStopEvent,
  type MessagesErrorEvent,
  type MessagesMessageDeltaEvent,
  type MessagesMessageStartEvent,
  type MessagesStreamEventData,
} from "../messages-types.ts";
import { makeResponsesReasoningId } from "../reasoning.ts";
import type {
  ResponseOutputFunctionCall,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseOutputReasoning,
  ResponsesResult,
  ResponseStreamEvent,
} from "../responses-types.ts";

type OutputBlockInfo =
  | {
    type: "thinking";
    outputIndex: number;
    itemId: string;
    thinkingText: string;
    signature: string;
  }
  | {
    type: "text";
    outputIndex: number;
    itemId: string;
    contentIndex: number;
    blockText: string;
  }
  | {
    type: "tool_use";
    outputIndex: number;
    itemId: string;
    toolCallId: string;
    toolName: string;
    toolArguments: string;
  };

interface MessagesToResponsesStreamState {
  responseId: string;
  model: string;
  responseCreated: boolean;
  outputIndex: number;
  sequenceNumber: number;
  blockMap: Map<number, OutputBlockInfo>;
  accumulatedText: string;
  completedItems: ResponseOutputItem[];
  completed: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

const withSequenceNumbers = (
  state: MessagesToResponsesStreamState,
  events: ResponseStreamEvent[],
): ResponseStreamEvent[] =>
  events.map((event) => ({
    ...event,
    sequence_number: state.sequenceNumber++,
  }));

const buildResult = (
  state: MessagesToResponsesStreamState,
  status: ResponsesResult["status"],
): ResponsesResult => {
  const inputTokens = state.inputTokens +
    (state.cacheReadInputTokens ?? 0) +
    (state.cacheCreationInputTokens ?? 0);

  return {
    id: state.responseId,
    object: "response",
    model: state.model,
    output: state.completedItems,
    output_text: state.accumulatedText,
    status,
    usage: {
      input_tokens: inputTokens,
      output_tokens: state.outputTokens,
      total_tokens: inputTokens + state.outputTokens,
      ...(state.cacheReadInputTokens !== undefined
        ? {
          input_tokens_details: { cached_tokens: state.cacheReadInputTokens },
        }
        : {}),
    },
  };
};

const handleMessageStart = (
  event: MessagesMessageStartEvent,
  state: MessagesToResponsesStreamState,
): ResponseStreamEvent[] => {
  state.inputTokens = event.message.usage?.input_tokens ?? 0;
  state.cacheReadInputTokens = event.message.usage?.cache_read_input_tokens;
  state.cacheCreationInputTokens = event.message.usage
    ?.cache_creation_input_tokens;

  if (state.responseCreated) return [];
  state.responseCreated = true;

  const response = buildResult(state, "in_progress");

  return withSequenceNumbers(state, [
    { type: "response.created", response },
    { type: "response.in_progress", response },
  ]);
};

const handleContentBlockStart = (
  event: MessagesContentBlockStartEvent,
  state: MessagesToResponsesStreamState,
): ResponseStreamEvent[] => {
  const outputIndex = state.outputIndex++;

  if (event.content_block.type === "thinking") {
    const itemId = makeResponsesReasoningId(outputIndex);
    state.blockMap.set(event.index, {
      type: "thinking",
      outputIndex,
      itemId,
      thinkingText: "",
      signature: "",
    });

    const item: ResponseOutputReasoning = {
      type: "reasoning",
      id: itemId,
      summary: [],
      encrypted_content: undefined,
    };

    return withSequenceNumbers(state, [
      { type: "response.output_item.added", output_index: outputIndex, item },
      {
        type: "response.reasoning_summary_part.added",
        item_id: itemId,
        output_index: outputIndex,
        summary_index: 0,
        part: { type: "summary_text", text: "" },
      },
    ]);
  }

  if (event.content_block.type === "text") {
    const itemId = `msg_${outputIndex}`;
    state.blockMap.set(event.index, {
      type: "text",
      outputIndex,
      itemId,
      contentIndex: 0,
      blockText: "",
    });

    const item: ResponseOutputMessage = {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "" }],
    };

    return withSequenceNumbers(state, [
      { type: "response.output_item.added", output_index: outputIndex, item },
      {
        type: "response.content_part.added",
        item_id: itemId,
        output_index: outputIndex,
        content_index: 0,
        part: { type: "output_text", text: "" },
      },
    ]);
  }

  if (event.content_block.type === "tool_use") {
    const itemId = `fc_${outputIndex}`;
    state.blockMap.set(event.index, {
      type: "tool_use",
      outputIndex,
      itemId,
      toolCallId: event.content_block.id,
      toolName: event.content_block.name,
      toolArguments: "",
    });

    const item: ResponseOutputFunctionCall = {
      type: "function_call",
      call_id: event.content_block.id,
      name: event.content_block.name,
      arguments: "",
      status: "in_progress",
    };

    return withSequenceNumbers(state, [
      { type: "response.output_item.added", output_index: outputIndex, item },
    ]);
  }

  return [];
};

const handleContentBlockDelta = (
  event: MessagesContentBlockDeltaEvent,
  state: MessagesToResponsesStreamState,
): ResponseStreamEvent[] => {
  const info = state.blockMap.get(event.index);
  if (!info) return [];

  if (event.delta.type === "thinking_delta" && info.type === "thinking") {
    info.thinkingText += event.delta.thinking;

    return withSequenceNumbers(state, [{
      type: "response.reasoning_summary_text.delta",
      item_id: info.itemId,
      output_index: info.outputIndex,
      summary_index: 0,
      delta: event.delta.thinking,
    }]);
  }

  if (event.delta.type === "signature_delta" && info.type === "thinking") {
    info.signature += event.delta.signature;
    return [];
  }

  if (event.delta.type === "text_delta" && info.type === "text") {
    info.blockText += event.delta.text;
    state.accumulatedText += event.delta.text;

    return withSequenceNumbers(state, [{
      type: "response.output_text.delta",
      item_id: info.itemId,
      output_index: info.outputIndex,
      content_index: info.contentIndex,
      delta: event.delta.text,
    }]);
  }

  if (event.delta.type === "input_json_delta" && info.type === "tool_use") {
    info.toolArguments += event.delta.partial_json;

    return withSequenceNumbers(state, [{
      type: "response.function_call_arguments.delta",
      item_id: info.itemId,
      output_index: info.outputIndex,
      delta: event.delta.partial_json,
    }]);
  }

  return [];
};

const handleContentBlockStop = (
  event: MessagesContentBlockStopEvent,
  state: MessagesToResponsesStreamState,
): ResponseStreamEvent[] => {
  const info = state.blockMap.get(event.index);
  if (!info) return [];

  state.blockMap.delete(event.index);

  if (info.type === "thinking") {
    const summaryText = info.thinkingText === MESSAGES_THINKING_PLACEHOLDER
      ? ""
      : info.thinkingText;

    const item: ResponseOutputReasoning = {
      type: "reasoning",
      id: info.itemId,
      summary: summaryText ? [{ type: "summary_text", text: summaryText }] : [],
      encrypted_content: info.signature || undefined,
    };

    state.completedItems.push(item);

    return withSequenceNumbers(state, [
      ...(summaryText
        ? [{
          type: "response.reasoning_summary_text.done" as const,
          item_id: info.itemId,
          output_index: info.outputIndex,
          summary_index: 0,
          text: summaryText,
        }]
        : []),
      {
        type: "response.reasoning_summary_part.done",
        item_id: info.itemId,
        output_index: info.outputIndex,
        summary_index: 0,
        part: { type: "summary_text", text: summaryText },
      },
      {
        type: "response.output_item.done",
        output_index: info.outputIndex,
        item,
      },
    ]);
  }

  if (info.type === "text") {
    const part = { type: "output_text" as const, text: info.blockText };
    const item: ResponseOutputMessage = {
      type: "message",
      role: "assistant",
      content: [part],
    };

    state.completedItems.push(item);

    return withSequenceNumbers(state, [
      {
        type: "response.output_text.done",
        item_id: info.itemId,
        output_index: info.outputIndex,
        content_index: info.contentIndex,
        text: info.blockText,
      },
      {
        type: "response.content_part.done",
        item_id: info.itemId,
        output_index: info.outputIndex,
        content_index: info.contentIndex,
        part,
      },
      {
        type: "response.output_item.done",
        output_index: info.outputIndex,
        item,
      },
    ]);
  }

  const item: ResponseOutputFunctionCall = {
    type: "function_call",
    call_id: info.toolCallId,
    name: info.toolName,
    arguments: info.toolArguments,
    status: "completed",
  };

  state.completedItems.push(item);

  return withSequenceNumbers(state, [
    {
      type: "response.function_call_arguments.done",
      item_id: info.itemId,
      output_index: info.outputIndex,
      arguments: info.toolArguments,
    },
    { type: "response.output_item.done", output_index: info.outputIndex, item },
  ]);
};

const handleMessageDelta = (
  event: MessagesMessageDeltaEvent,
  state: MessagesToResponsesStreamState,
): ResponseStreamEvent[] => {
  if (event.usage?.output_tokens != null) {
    state.outputTokens = event.usage.output_tokens;
  }

  return [];
};

const handleMessageStop = (
  state: MessagesToResponsesStreamState,
): ResponseStreamEvent[] => {
  if (state.completed) return [];
  state.completed = true;

  return withSequenceNumbers(state, [{
    type: "response.completed",
    response: buildResult(state, "completed"),
  }]);
};

const handleError = (
  event: MessagesErrorEvent,
  state: MessagesToResponsesStreamState,
): ResponseStreamEvent[] => {
  state.completed = true;

  return withSequenceNumbers(state, [{
    type: "error",
    message: event.error?.message ?? "An unexpected error occurred.",
    code: event.error?.type,
  }]);
};

export const createMessagesToResponsesStreamState = (
  responseId: string,
  model: string,
): MessagesToResponsesStreamState => ({
  responseId,
  model,
  responseCreated: false,
  outputIndex: 0,
  sequenceNumber: 0,
  blockMap: new Map(),
  accumulatedText: "",
  completedItems: [],
  completed: false,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadInputTokens: undefined,
  cacheCreationInputTokens: undefined,
});

export const translateMessagesEventToResponsesEvents = (
  event: MessagesStreamEventData,
  state: MessagesToResponsesStreamState,
): ResponseStreamEvent[] => {
  if (state.completed) return [];

  switch (event.type) {
    case "message_start":
      return handleMessageStart(event, state);
    case "content_block_start":
      return handleContentBlockStart(event, state);
    case "content_block_delta":
      return handleContentBlockDelta(event, state);
    case "content_block_stop":
      return handleContentBlockStop(event, state);
    case "message_delta":
      return handleMessageDelta(event, state);
    case "message_stop":
      return handleMessageStop(state);
    case "ping":
      return withSequenceNumbers(state, [{ type: "ping" }]);
    case "error":
      return handleError(event, state);
    default:
      return [];
  }
};
