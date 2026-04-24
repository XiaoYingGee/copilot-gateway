import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
  ContentPart,
  Tool,
} from "../chat-completions-types.ts";
import { makeResponsesReasoningId } from "../reasoning.ts";
import type {
  ResponseInputContent,
  ResponseInputItem,
  ResponseOutputFunctionCall,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseOutputReasoning,
  ResponseStreamEvent,
  ResponseTool,
  ResponseToolChoice,
  ResponsesPayload,
  ResponsesResult,
} from "../responses-types.ts";
import { checkWhitespaceOverflow } from "./utils.ts";

const extractTextContent = (
  content: string | ContentPart[] | null,
): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((part): part is Extract<ContentPart, { type: "text" }> =>
      part.type === "text"
    )
    .map((part) => part.text)
    .join("");
};

const toResponsesContent = (
  content: string | ContentPart[] | null,
): string | ResponseInputContent[] => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: ResponseInputContent[] = [];

  for (const part of content) {
    if (part.type === "text") {
      parts.push({ type: "input_text", text: part.text });
      continue;
    }

    parts.push({
      type: "input_image",
      image_url: part.image_url.url,
      detail: part.image_url.detail ?? "auto",
    });
  }

  return parts.length > 0 ? parts : "";
};

const toResponsesAssistantContent = (
  content: string | ContentPart[] | null,
): string | ResponseInputContent[] => {
  const text = extractTextContent(content);
  return text ? [{ type: "output_text", text }] : "";
};

const translateChatTools = (tools?: Tool[] | null): ResponseTool[] | null =>
  tools?.length
    ? tools.map((tool) => ({
      type: "function",
      name: tool.function.name,
      parameters: tool.function.parameters,
      strict: tool.function.strict ?? false,
      ...(tool.function.description
        ? { description: tool.function.description }
        : {}),
    }))
    : null;

const translateChatToolChoice = (
  choice?: ChatCompletionsPayload["tool_choice"],
): ResponseToolChoice => {
  if (!choice) return "auto";
  if (typeof choice === "string") {
    return choice === "none" || choice === "auto" || choice === "required"
      ? choice
      : "auto";
  }

  return choice.type === "function" && choice.function?.name
    ? { type: "function", name: choice.function.name }
    : "auto";
};

export const translateChatCompletionsToResponses = (
  payload: ChatCompletionsPayload,
): ResponsesPayload => {
  const instructions: string[] = [];
  const input: ResponseInputItem[] = [];

  for (const message of payload.messages) {
    if (message.role === "system" || message.role === "developer") {
      const text = extractTextContent(message.content);
      if (text) instructions.push(text);
      continue;
    }

    if (message.role === "user") {
      input.push({
        type: "message",
        role: "user",
        content: toResponsesContent(message.content),
      });
      continue;
    }

    if (message.role === "assistant") {
      if (message.reasoning_opaque) {
        input.push({
          type: "reasoning",
          id: makeResponsesReasoningId(input.length),
          summary: message.reasoning_text
            ? [{ type: "summary_text", text: message.reasoning_text }]
            : [],
          encrypted_content: message.reasoning_opaque,
        });
      }

      if (message.tool_calls?.length) {
        const text = extractTextContent(message.content);
        if (text) {
          input.push({
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text }],
          });
        }

        for (const toolCall of message.tool_calls) {
          input.push({
            type: "function_call",
            call_id: toolCall.id,
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
            status: "completed",
          });
        }

        continue;
      }

      input.push({
        type: "message",
        role: "assistant",
        content: toResponsesAssistantContent(message.content),
      });
      continue;
    }

    if (!message.tool_call_id) {
      throw new Error(
        "tool message requires tool_call_id for Responses translation",
      );
    }

    input.push({
      type: "function_call_output",
      call_id: message.tool_call_id,
      output: typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content),
    });
  }

  return {
    model: payload.model,
    input,
    instructions: instructions.length > 0 ? instructions.join("\n\n") : null,
    temperature: payload.temperature ?? null,
    top_p: payload.top_p ?? null,
    max_output_tokens: payload.max_tokens ?? null,
    tools: translateChatTools(payload.tools),
    tool_choice: translateChatToolChoice(payload.tool_choice),
    metadata: null,
    stream: payload.stream ?? null,
    store: false,
    parallel_tool_calls: true,
    // Non-standard Chat Completions top-level fields stay on the native
    // `/chat/completions` path. Pairwise translation only carries explicit
    // source-side contract fields.
  };
};

const mapUsage = (
  usage: ChatCompletionResponse["usage"] | undefined,
): ResponsesResult["usage"] | undefined =>
  usage
    ? {
      input_tokens: usage.prompt_tokens,
      output_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens,
      ...(usage.prompt_tokens_details?.cached_tokens !== undefined
        ? {
          input_tokens_details: {
            cached_tokens: usage.prompt_tokens_details.cached_tokens,
          },
        }
        : {}),
    }
    : undefined;

const mapResultStatus = (
  finishReason: ChatCompletionResponse["choices"][0]["finish_reason"],
): ResponsesResult["status"] =>
  finishReason === "length" ? "incomplete" : "completed";

export const translateChatCompletionToResponsesResult = (
  response: ChatCompletionResponse,
): ResponsesResult => {
  const choice = response.choices[0];
  const output: ResponseOutputItem[] = [];
  const reasoningText = choice.message.reasoning_text;
  const reasoningOpaque = choice.message.reasoning_opaque;

  if (reasoningText || reasoningOpaque) {
    output.push({
      type: "reasoning",
      id: makeResponsesReasoningId(output.length),
      summary: reasoningText
        ? [{ type: "summary_text", text: reasoningText }]
        : [],
      ...(reasoningOpaque ? { encrypted_content: reasoningOpaque } : {}),
    } satisfies ResponseOutputReasoning);
  }

  if (choice.message.content) {
    output.push({
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: choice.message.content }],
    } satisfies ResponseOutputMessage);
  }

  for (const toolCall of choice.message.tool_calls ?? []) {
    output.push({
      type: "function_call",
      call_id: toolCall.id,
      name: toolCall.function.name,
      arguments: toolCall.function.arguments,
      status: "completed",
    } satisfies ResponseOutputFunctionCall);
  }

  return {
    id: response.id,
    object: "response",
    model: response.model,
    output,
    output_text: choice.message.content ?? "",
    status: mapResultStatus(choice.finish_reason),
    ...(choice.finish_reason === "length"
      ? { incomplete_details: { reason: "max_output_tokens" } }
      : {}),
    usage: mapUsage(response.usage),
  };
};

interface PendingReasoningItem {
  outputIndex: number;
  itemId: string;
  text: string;
  signature: string;
}

interface PendingTextItem {
  outputIndex: number;
  itemId: string;
  text: string;
}

interface PendingFunctionCallItem {
  outputIndex?: number;
  itemId?: string;
  callId?: string;
  name?: string;
  arguments: string;
  consecutiveWhitespace: number;
}

interface ChatCompletionsToResponsesStreamState {
  responseCreated: boolean;
  outputIndex: number;
  sequenceNumber: number;
  responseId: string;
  model: string;
  outputText: string;
  completedItems: ResponseOutputItem[];
  openReasoning: PendingReasoningItem | null;
  openText: PendingTextItem | null;
  openFunctionCalls: Map<number, PendingFunctionCallItem>;
  usage?: ResponsesResult["usage"];
  pendingFinishReason?: ChatCompletionResponse["choices"][0]["finish_reason"];
  completed: boolean;
}

export const createChatCompletionsToResponsesStreamState = (): ChatCompletionsToResponsesStreamState => ({
  responseCreated: false,
  outputIndex: 0,
  sequenceNumber: 0,
  responseId: "",
  model: "",
  outputText: "",
  completedItems: [],
  openReasoning: null,
  openText: null,
  openFunctionCalls: new Map(),
  usage: undefined,
  pendingFinishReason: undefined,
  completed: false,
});

const seq = (
  state: ChatCompletionsToResponsesStreamState,
  events: ResponseStreamEvent[],
): ResponseStreamEvent[] =>
  events.map((event) => ({ ...event, sequence_number: state.sequenceNumber++ }));

const buildResult = (
  state: ChatCompletionsToResponsesStreamState,
  status: ResponsesResult["status"],
): ResponsesResult => ({
  id: state.responseId,
  object: "response",
  model: state.model,
  output: state.completedItems,
  output_text: state.outputText,
  status,
  ...(state.pendingFinishReason === "length"
    ? { incomplete_details: { reason: "max_output_tokens" } }
    : {}),
  ...(state.usage ? { usage: state.usage } : {}),
});

const ensureResponseCreated = (
  chunk: ChatCompletionChunk,
  state: ChatCompletionsToResponsesStreamState,
): ResponseStreamEvent[] => {
  state.responseId = chunk.id;
  state.model = chunk.model;

  if (chunk.usage) {
    state.usage = mapUsage(chunk.usage);
  }

  if (state.responseCreated) return [];

  state.responseCreated = true;
  const response = buildResult(state, "in_progress");

  return seq(state, [
    { type: "response.created", response },
    { type: "response.in_progress", response },
  ]);
};

const closeReasoning = (
  state: ChatCompletionsToResponsesStreamState,
): ResponseStreamEvent[] => {
  if (!state.openReasoning) return [];

  const reasoning = state.openReasoning;
  state.openReasoning = null;

  const item: ResponseOutputReasoning = {
    type: "reasoning",
    id: reasoning.itemId,
    summary: reasoning.text
      ? [{ type: "summary_text", text: reasoning.text }]
      : [],
    ...(reasoning.signature
      ? { encrypted_content: reasoning.signature }
      : {}),
  };

  state.completedItems.push(item);

  return seq(state, [
    ...(reasoning.text
      ? [{
        type: "response.reasoning_summary_text.done" as const,
        item_id: reasoning.itemId,
        output_index: reasoning.outputIndex,
        summary_index: 0,
        text: reasoning.text,
      }]
      : []),
    {
      type: "response.reasoning_summary_part.done",
      item_id: reasoning.itemId,
      output_index: reasoning.outputIndex,
      summary_index: 0,
      part: { type: "summary_text", text: reasoning.text },
    },
    {
      type: "response.output_item.done",
      output_index: reasoning.outputIndex,
      item,
    },
  ]);
};

const closeText = (
  state: ChatCompletionsToResponsesStreamState,
): ResponseStreamEvent[] => {
  if (!state.openText) return [];

  const textItem = state.openText;
  state.openText = null;

  const part = { type: "output_text" as const, text: textItem.text };
  const item: ResponseOutputMessage = {
    type: "message",
    role: "assistant",
    content: [part],
  };

  state.completedItems.push(item);

  return seq(state, [
    {
      type: "response.output_text.done",
      item_id: textItem.itemId,
      output_index: textItem.outputIndex,
      content_index: 0,
      text: textItem.text,
    },
    {
      type: "response.content_part.done",
      item_id: textItem.itemId,
      output_index: textItem.outputIndex,
      content_index: 0,
      part,
    },
    {
      type: "response.output_item.done",
      output_index: textItem.outputIndex,
      item,
    },
  ]);
};

const closeFunctionCalls = (
  state: ChatCompletionsToResponsesStreamState,
): ResponseStreamEvent[] => {
  const events: ResponseStreamEvent[] = [];

  for (const functionCall of [...state.openFunctionCalls.values()].sort((a, b) =>
    (a.outputIndex ?? Number.MAX_SAFE_INTEGER) -
    (b.outputIndex ?? Number.MAX_SAFE_INTEGER)
  )) {
    if (
      functionCall.outputIndex == null ||
      !functionCall.itemId ||
      !functionCall.callId ||
      !functionCall.name
    ) {
      continue;
    }

    const item: ResponseOutputFunctionCall = {
      type: "function_call",
      call_id: functionCall.callId,
      name: functionCall.name,
      arguments: functionCall.arguments,
      status: "completed",
    };

    state.completedItems.push(item);
    events.push(
      {
        type: "response.function_call_arguments.done",
        item_id: functionCall.itemId,
        output_index: functionCall.outputIndex,
        arguments: functionCall.arguments,
      },
      {
        type: "response.output_item.done",
        output_index: functionCall.outputIndex,
        item,
      },
    );
  }

  state.openFunctionCalls.clear();
  return seq(state, events);
};

const ensureReasoning = (
  state: ChatCompletionsToResponsesStreamState,
): ResponseStreamEvent[] => {
  if (state.openReasoning) return [];

  const outputIndex = state.outputIndex++;
  const itemId = makeResponsesReasoningId(outputIndex);
  state.openReasoning = { outputIndex, itemId, text: "", signature: "" };

  return seq(state, [
    {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: { type: "reasoning", id: itemId, summary: [] },
    },
    {
      type: "response.reasoning_summary_part.added",
      item_id: itemId,
      output_index: outputIndex,
      summary_index: 0,
      part: { type: "summary_text", text: "" },
    },
  ]);
};

const ensureText = (
  state: ChatCompletionsToResponsesStreamState,
): ResponseStreamEvent[] => {
  if (state.openText) return [];

  const outputIndex = state.outputIndex++;
  const itemId = `msg_${outputIndex}`;
  state.openText = { outputIndex, itemId, text: "" };

  return seq(state, [
    {
      type: "response.output_item.added",
      output_index: outputIndex,
      item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "" }],
      },
    },
    {
      type: "response.content_part.added",
      item_id: itemId,
      output_index: outputIndex,
      content_index: 0,
      part: { type: "output_text", text: "" },
    },
  ]);
};

const ensureFunctionCall = (
  toolCallIndex: number,
  state: ChatCompletionsToResponsesStreamState,
): ResponseStreamEvent[] => {
  const current = state.openFunctionCalls.get(toolCallIndex);
  if (
    !current ||
    current.outputIndex != null ||
    !current.callId ||
    !current.name
  ) {
    return [];
  }

  current.outputIndex = state.outputIndex++;
  current.itemId = `fc_${current.outputIndex}`;

  const events: ResponseStreamEvent[] = [{
    type: "response.output_item.added",
    output_index: current.outputIndex,
    item: {
      type: "function_call",
      call_id: current.callId,
      name: current.name,
      arguments: "",
      status: "in_progress",
    },
  }];

  if (current.arguments) {
    events.push({
      type: "response.function_call_arguments.delta",
      item_id: current.itemId,
      output_index: current.outputIndex,
      delta: current.arguments,
    });
  }

  return seq(state, events);
};

const finalize = (
  state: ChatCompletionsToResponsesStreamState,
): ResponseStreamEvent[] => {
  if (state.completed || state.pendingFinishReason == null) return [];

  state.completed = true;

  return [
    ...closeReasoning(state),
    ...closeText(state),
    ...closeFunctionCalls(state),
    ...seq(state, [{
      type: state.pendingFinishReason === "length"
        ? "response.incomplete"
        : "response.completed",
      response: buildResult(
        state,
        state.pendingFinishReason === "length" ? "incomplete" : "completed",
      ),
    }]),
  ];
};

export const translateChatCompletionsChunkToResponsesEvents = (
  chunk: ChatCompletionChunk,
  state: ChatCompletionsToResponsesStreamState,
): ResponseStreamEvent[] => {
  const events = ensureResponseCreated(chunk, state);

  if (chunk.usage) {
    state.usage = mapUsage(chunk.usage);
  }

  if (chunk.choices.length === 0) {
    return [...events, ...finalize(state)];
  }

  for (const choice of chunk.choices) {
    if (choice.delta.reasoning_text || choice.delta.reasoning_opaque) {
      events.push(...closeText(state));
      events.push(...ensureReasoning(state));

      if (choice.delta.reasoning_text && state.openReasoning) {
        state.openReasoning.text += choice.delta.reasoning_text;
        events.push(...seq(state, [{
          type: "response.reasoning_summary_text.delta",
          item_id: state.openReasoning.itemId,
          output_index: state.openReasoning.outputIndex,
          summary_index: 0,
          delta: choice.delta.reasoning_text,
        }]));
      }

      if (choice.delta.reasoning_opaque && state.openReasoning) {
        state.openReasoning.signature += choice.delta.reasoning_opaque;
      }
    }

    if (choice.delta.content) {
      events.push(...closeReasoning(state));
      events.push(...ensureText(state));

      if (state.openText) {
        state.openText.text += choice.delta.content;
        state.outputText += choice.delta.content;
        events.push(...seq(state, [{
          type: "response.output_text.delta",
          item_id: state.openText.itemId,
          output_index: state.openText.outputIndex,
          content_index: 0,
          delta: choice.delta.content,
        }]));
      }
    }

    if (choice.delta.tool_calls) {
      events.push(...closeReasoning(state));
      events.push(...closeText(state));

      for (const toolCall of choice.delta.tool_calls) {
        const current = state.openFunctionCalls.get(toolCall.index) ?? {
          arguments: "",
          consecutiveWhitespace: 0,
        };

        if (toolCall.id) current.callId = toolCall.id;
        if (toolCall.function?.name) current.name = toolCall.function.name;
        state.openFunctionCalls.set(toolCall.index, current);
        events.push(...ensureFunctionCall(toolCall.index, state));

        if (!toolCall.function?.arguments) continue;

        const whitespace = checkWhitespaceOverflow(
          toolCall.function.arguments,
          current.consecutiveWhitespace,
        );
        current.consecutiveWhitespace = whitespace.count;

        if (whitespace.exceeded) {
          state.completed = true;
          return [
            ...events,
            ...seq(state, [{
              type: "error",
              message:
                "Tool call arguments contained excessive whitespace, indicating a degenerate response.",
              code: "api_error",
            }]),
          ];
        }

        current.arguments += toolCall.function.arguments;

        if (current.outputIndex != null && current.itemId) {
          events.push(...seq(state, [{
            type: "response.function_call_arguments.delta",
            item_id: current.itemId,
            output_index: current.outputIndex,
            delta: toolCall.function.arguments,
          }]));
        }
      }
    }

    if (choice.finish_reason) {
      state.pendingFinishReason = choice.finish_reason;
    }
  }

  return events;
};

export const flushChatCompletionsToResponsesEvents = (
  state: ChatCompletionsToResponsesStreamState,
): ResponseStreamEvent[] => finalize(state);
