import type {
  AnthropicStreamEventData,
  AnthropicMessageStartEvent,
  AnthropicContentBlockStartEvent,
  AnthropicContentBlockDeltaEvent,
  AnthropicContentBlockStopEvent,
  AnthropicMessageDeltaEvent,
  AnthropicErrorEvent,
} from "../anthropic-types.ts";
import { THINKING_PLACEHOLDER } from "../anthropic-types.ts";
import type {
  ResponseStreamEvent,
  ResponsesResult,
  ResponseOutputItem,
  ResponseOutputFunctionCall,
  ResponseOutputMessage,
  ResponseOutputReasoning,
} from "../responses-types.ts";

type OutputBlockInfo =
  | { type: "thinking"; outputIndex: number; itemId: string; thinkingText: string; signature: string }
  | { type: "text"; outputIndex: number; itemId: string; contentIndex: number; blockText: string }
  | { type: "tool_use"; outputIndex: number; itemId: string; toolCallId: string; toolName: string; toolArguments: string };

export interface AnthropicToResponsesStreamState {
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
}

export function createAnthropicToResponsesStreamState(
  responseId: string,
  model: string,
): AnthropicToResponsesStreamState {
  return {
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
  };
}

function seq(state: AnthropicToResponsesStreamState, events: ResponseStreamEvent[]): ResponseStreamEvent[] {
  return events.map((e) => ({ ...e, sequence_number: state.sequenceNumber++ }));
}

export function translateAnthropicEventToResponsesEvents(
  event: AnthropicStreamEventData,
  state: AnthropicToResponsesStreamState,
): ResponseStreamEvent[] {
  if (state.completed) return [];

  switch (event.type) {
    case "message_start": return handleMessageStart(event, state);
    case "content_block_start": return handleContentBlockStart(event, state);
    case "content_block_delta": return handleContentBlockDelta(event, state);
    case "content_block_stop": return handleContentBlockStop(event, state);
    case "message_delta": return handleMessageDelta(event, state);
    case "message_stop": return handleMessageStop(state);
    case "ping": return seq(state, [{ type: "ping" }]);
    case "error": return handleError(event, state);
    default: return [];
  }
}

function handleMessageStart(event: AnthropicMessageStartEvent, state: AnthropicToResponsesStreamState): ResponseStreamEvent[] {
  const message = event.message;
  state.inputTokens = message.usage?.input_tokens ?? 0;
  state.cacheReadInputTokens = message.usage?.cache_read_input_tokens;

  if (state.responseCreated) return [];
  state.responseCreated = true;

  const response = buildResult(state, "in_progress");
  return seq(state, [
    { type: "response.created", response },
    { type: "response.in_progress", response },
  ]);
}

function handleContentBlockStart(event: AnthropicContentBlockStartEvent, state: AnthropicToResponsesStreamState): ResponseStreamEvent[] {
  const index = event.index;
  const contentBlock = event.content_block;
  const outputIdx = state.outputIndex++;

  if (contentBlock.type === "thinking") {
    const itemId = `rs_${outputIdx}`;
    state.blockMap.set(index, { type: "thinking", outputIndex: outputIdx, itemId, thinkingText: "", signature: "" });
    const item: ResponseOutputReasoning = { type: "reasoning", id: itemId, summary: [], encrypted_content: undefined };
    return seq(state, [
      { type: "response.output_item.added", output_index: outputIdx, item },
      { type: "response.reasoning_summary_part.added", item_id: itemId, output_index: outputIdx, summary_index: 0, part: { type: "summary_text", text: "" } },
    ]);
  }

  if (contentBlock.type === "text") {
    const itemId = `msg_${outputIdx}`;
    state.blockMap.set(index, { type: "text", outputIndex: outputIdx, itemId, contentIndex: 0, blockText: "" });
    const item: ResponseOutputMessage = { type: "message", role: "assistant", content: [{ type: "output_text", text: "" }] };
    return seq(state, [
      { type: "response.output_item.added", output_index: outputIdx, item },
      { type: "response.content_part.added", item_id: itemId, output_index: outputIdx, content_index: 0, part: { type: "output_text", text: "" } },
    ]);
  }

  if (contentBlock.type === "tool_use") {
    const itemId = `fc_${outputIdx}`;
    state.blockMap.set(index, { type: "tool_use", outputIndex: outputIdx, itemId, toolCallId: contentBlock.id, toolName: contentBlock.name, toolArguments: "" });
    const item: ResponseOutputFunctionCall = { type: "function_call", call_id: contentBlock.id, name: contentBlock.name, arguments: "", status: "in_progress" };
    return seq(state, [
      { type: "response.output_item.added", output_index: outputIdx, item },
    ]);
  }

  return [];
}

function handleContentBlockDelta(event: AnthropicContentBlockDeltaEvent, state: AnthropicToResponsesStreamState): ResponseStreamEvent[] {
  const info = state.blockMap.get(event.index);
  if (!info) return [];
  const delta = event.delta;

  if (delta.type === "thinking_delta" && info.type === "thinking") {
    info.thinkingText += delta.thinking;
    return seq(state, [{
      type: "response.reasoning_summary_text.delta",
      item_id: info.itemId,
      output_index: info.outputIndex,
      summary_index: 0,
      delta: delta.thinking,
    }]);
  }

  if (delta.type === "signature_delta" && info.type === "thinking") {
    info.signature += delta.signature;
    return [];
  }

  if (delta.type === "text_delta" && info.type === "text") {
    info.blockText += delta.text;
    state.accumulatedText += delta.text;
    return seq(state, [{
      type: "response.output_text.delta",
      item_id: info.itemId,
      output_index: info.outputIndex,
      content_index: info.contentIndex,
      delta: delta.text,
    }]);
  }

  if (delta.type === "input_json_delta" && info.type === "tool_use") {
    info.toolArguments += delta.partial_json;
    return seq(state, [{
      type: "response.function_call_arguments.delta",
      item_id: info.itemId,
      output_index: info.outputIndex,
      delta: delta.partial_json,
    }]);
  }

  return [];
}

function handleContentBlockStop(event: AnthropicContentBlockStopEvent, state: AnthropicToResponsesStreamState): ResponseStreamEvent[] {
  const info = state.blockMap.get(event.index);
  if (!info) return [];
  state.blockMap.delete(event.index);

  const events: ResponseStreamEvent[] = [];

  if (info.type === "thinking") {
    const summaryText = info.thinkingText === THINKING_PLACEHOLDER ? "" : info.thinkingText;

    if (summaryText) {
      events.push({ type: "response.reasoning_summary_text.done", item_id: info.itemId, output_index: info.outputIndex, summary_index: 0, text: summaryText });
    }
    events.push({ type: "response.reasoning_summary_part.done", item_id: info.itemId, output_index: info.outputIndex, summary_index: 0, part: { type: "summary_text", text: summaryText } });
    const item: ResponseOutputReasoning = {
      type: "reasoning", id: info.itemId,
      summary: summaryText ? [{ type: "summary_text", text: summaryText }] : [],
      encrypted_content: info.signature || undefined,
    };
    state.completedItems.push(item);
    events.push({ type: "response.output_item.done", output_index: info.outputIndex, item });
  } else if (info.type === "text") {
    events.push({ type: "response.output_text.done", item_id: info.itemId, output_index: info.outputIndex, content_index: info.contentIndex, text: info.blockText });
    const part = { type: "output_text" as const, text: info.blockText };
    events.push({ type: "response.content_part.done", item_id: info.itemId, output_index: info.outputIndex, content_index: info.contentIndex, part });
    const item: ResponseOutputMessage = { type: "message", role: "assistant", content: [part] };
    state.completedItems.push(item);
    events.push({ type: "response.output_item.done", output_index: info.outputIndex, item });
  } else if (info.type === "tool_use") {
    events.push({ type: "response.function_call_arguments.done", item_id: info.itemId, output_index: info.outputIndex, arguments: info.toolArguments });
    const item: ResponseOutputFunctionCall = { type: "function_call", call_id: info.toolCallId, name: info.toolName, arguments: info.toolArguments, status: "completed" };
    state.completedItems.push(item);
    events.push({ type: "response.output_item.done", output_index: info.outputIndex, item });
  }

  return seq(state, events);
}

function handleMessageDelta(event: AnthropicMessageDeltaEvent, state: AnthropicToResponsesStreamState): ResponseStreamEvent[] {
  if (event.usage?.output_tokens != null) {
    state.outputTokens = event.usage.output_tokens;
  }
  return [];
}

function handleMessageStop(state: AnthropicToResponsesStreamState): ResponseStreamEvent[] {
  if (state.completed) return [];
  state.completed = true;
  return seq(state, [{ type: "response.completed", response: buildResult(state, "completed") }]);
}

function handleError(event: AnthropicErrorEvent, state: AnthropicToResponsesStreamState): ResponseStreamEvent[] {
  state.completed = true;
  return seq(state, [{ type: "error", message: event.error?.message ?? "An unexpected error occurred.", code: event.error?.type }]);
}

function buildResult(state: AnthropicToResponsesStreamState, status: ResponsesResult["status"]): ResponsesResult {
  const totalInputTokens = state.inputTokens + (state.cacheReadInputTokens ?? 0);
  return {
    id: state.responseId,
    object: "response",
    model: state.model,
    output: state.completedItems,
    output_text: state.accumulatedText,
    status,
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: state.outputTokens,
      total_tokens: totalInputTokens + state.outputTokens,
      ...(state.cacheReadInputTokens !== undefined && {
        input_tokens_details: { cached_tokens: state.cacheReadInputTokens },
      }),
    },
  };
}
