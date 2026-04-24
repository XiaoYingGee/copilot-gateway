import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
  ContentPart,
  Delta,
  Message,
  Tool,
  ToolCall,
} from "../chat-completions-types.ts";
import type {
  ResponseInputContent,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseTool,
  ResponseToolChoice,
  ResponsesPayload,
  ResponsesResult,
  ResponseStreamEvent,
} from "../responses-types.ts";

const toChatCompletionsContent = (
  content: string | ResponseInputContent[],
): string | ContentPart[] => {
  if (typeof content === "string") return content;

  const parts: ContentPart[] = [];

  for (const part of content) {
    if (part.type === "input_text" || part.type === "output_text") {
      parts.push({ type: "text", text: part.text });
      continue;
    }

    if (part.type !== "input_image") continue;

    parts.push({
      type: "image_url",
      image_url: {
        url: part.image_url,
        detail: part.detail,
      },
    });
  }

  return parts.some((part) => part.type === "image_url")
    ? parts
    : parts
      .filter((part): part is Extract<ContentPart, { type: "text" }> =>
        part.type === "text"
      )
      .map((part) => part.text)
      .join("");
};

const toAssistantText = (
  content: string | ResponseInputContent[],
): string => {
  if (typeof content === "string") return content;

  return content
    .filter((part): part is Extract<ResponseInputContent, { text: string }> =>
      part.type === "input_text" || part.type === "output_text"
    )
    .map((part) => part.text)
    .join("");
};

const ensureAssistant = (assistant: Message | null): Message =>
  assistant ?? { role: "assistant", content: null };

const appendAssistantText = (
  assistant: Message | null,
  text: string,
): Message | null => {
  if (!text) return assistant;

  const next = ensureAssistant(assistant);
  next.content = typeof next.content === "string" ? next.content + text : text;
  return next;
};

const appendAssistantReasoning = (
  assistant: Message | null,
  item: Extract<ResponseInputItem, { type: "reasoning" }>,
): Message => {
  const next = ensureAssistant(assistant);
  const reasoningText = item.summary.map((part) => part.text).join("");

  next.reasoning_text = typeof next.reasoning_text === "string"
    ? next.reasoning_text + reasoningText
    : reasoningText;
  next.reasoning_opaque = typeof next.reasoning_opaque === "string"
    ? next.reasoning_opaque + item.encrypted_content
    : item.encrypted_content;

  return next;
};

const appendAssistantToolCall = (
  assistant: Message | null,
  item: Extract<ResponseInputItem, { type: "function_call" }>,
): Message => {
  const next = ensureAssistant(assistant);
  next.tool_calls = [
    ...(next.tool_calls ?? []),
    {
      id: item.call_id,
      type: "function",
      function: {
        name: item.name,
        arguments: item.arguments,
      },
    } satisfies ToolCall,
  ];
  return next;
};

const translateResponseTools = (
  tools: ResponseTool[] | null,
): Tool[] | undefined =>
  tools?.length
    ? tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        parameters: tool.parameters,
        strict: tool.strict,
        ...(tool.description ? { description: tool.description } : {}),
      },
    }))
    : undefined;

const translateResponseToolChoice = (
  choice: ResponseToolChoice,
): ChatCompletionsPayload["tool_choice"] =>
  typeof choice === "string"
    ? choice
    : { type: "function", function: { name: choice.name } };

export const translateResponsesToChatCompletions = (
  payload: ResponsesPayload,
): ChatCompletionsPayload => {
  const messages: Message[] = payload.instructions
    ? [{ role: "system", content: payload.instructions }]
    : [];

  if (typeof payload.input === "string") {
    messages.push({ role: "user", content: payload.input });
  } else {
    let assistant: Message | null = null;
    const flushAssistant = () => {
      if (!assistant) return;
      messages.push(assistant);
      assistant = null;
    };

    for (const item of payload.input) {
      if (item.type === "reasoning") {
        assistant = appendAssistantReasoning(assistant, item);
        continue;
      }

      if (item.type === "function_call") {
        assistant = appendAssistantToolCall(assistant, item);
        continue;
      }

      if (item.type === "function_call_output") {
        flushAssistant();
        messages.push({
          role: "tool",
          tool_call_id: item.call_id,
          content: item.output,
        });
        continue;
      }

      if (item.role === "assistant") {
        assistant = appendAssistantText(assistant, toAssistantText(item.content));
        continue;
      }

      flushAssistant();
      messages.push({
        role: item.role,
        content: toChatCompletionsContent(item.content),
      });
    }

    flushAssistant();
  }

  return {
    model: payload.model,
    messages,
    max_tokens: payload.max_output_tokens,
    stream: payload.stream,
    temperature: payload.temperature,
    top_p: payload.top_p,
    // Chat Completions has no request-level counterpart for Responses
    // `reasoning`; only explicit reasoning items survive this translation.
    ...(typeof payload.metadata?.user_id === "string"
      ? { user: payload.metadata.user_id }
      : {}),
    tools: translateResponseTools(payload.tools),
    tool_choice: translateResponseToolChoice(payload.tool_choice),
  };
};

const mapFinishReason = (
  response: ResponsesResult,
): ChatCompletionResponse["choices"][0]["finish_reason"] => {
  if (response.status === "completed") {
    return response.output.some((item) => item.type === "function_call")
      ? "tool_calls"
      : "stop";
  }

  if (
    response.status === "incomplete" &&
    response.incomplete_details?.reason === "max_output_tokens"
  ) {
    return "length";
  }

  return "stop";
};

export const translateResponsesToChatCompletion = (
  response: ResponsesResult,
): ChatCompletionResponse => {
  let content = "";
  const toolCalls: ToolCall[] = [];
  let reasoningText: string | undefined;
  let reasoningOpaque: string | undefined;

  for (const item of response.output) {
    if (item.type === "message") {
      for (const block of item.content) {
        if (block.type === "output_text") {
          content += block.text;
          continue;
        }

        content += block.refusal;
      }
      continue;
    }

    if (item.type === "function_call") {
      toolCalls.push({
        id: item.call_id,
        type: "function",
        function: { name: item.name, arguments: item.arguments },
      });
      continue;
    }

    const text = item.summary.map((part) => part.text).join("");
    if (text) {
      reasoningText = typeof reasoningText === "string"
        ? reasoningText + text
        : text;
    }

    if (item.encrypted_content) {
      reasoningOpaque = typeof reasoningOpaque === "string"
        ? reasoningOpaque + item.encrypted_content
        : item.encrypted_content;
    }
  }

  if (!content && response.output_text) {
    content = response.output_text;
  }

  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const cachedTokens = response.usage?.input_tokens_details?.cached_tokens;

  return {
    id: response.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: content || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        ...(reasoningText !== undefined ? { reasoning_text: reasoningText } : {}),
        ...(reasoningOpaque !== undefined
          ? { reasoning_opaque: reasoningOpaque }
          : {}),
      },
      finish_reason: mapFinishReason(response),
    }],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      ...(cachedTokens !== undefined
        ? { prompt_tokens_details: { cached_tokens: cachedTokens } }
        : {}),
    },
  };
};

interface ResponsesToChatCompletionsStreamState {
  messageId: string;
  model: string;
  created: number;
  toolCallIndex: number;
  functionCallIndices: Map<number, number>;
  inputTokens: number;
  cachedTokens: number;
  done: boolean;
}

export const createResponsesToChatCompletionsStreamState = (): ResponsesToChatCompletionsStreamState => ({
  messageId: "",
  model: "",
  created: Math.floor(Date.now() / 1000),
  toolCallIndex: -1,
  functionCallIndices: new Map(),
  inputTokens: 0,
  cachedTokens: 0,
  done: false,
});

export const translateResponsesEventToChatCompletionsChunks = (
  event: ResponseStreamEvent,
  state: ResponsesToChatCompletionsStreamState,
): ChatCompletionChunk[] | "DONE" => {
  if (state.done) return [];

  switch (event.type) {
    case "response.created": {
      const { response } =
        event as Extract<ResponseStreamEvent, { type: "response.created" }>;
      state.messageId = response.id;
      state.model = response.model;
      state.inputTokens = response.usage?.input_tokens ?? 0;
      state.cachedTokens =
        response.usage?.input_tokens_details?.cached_tokens ?? 0;
      return [makeChunk(state, { role: "assistant" })];
    }

    case "response.output_item.added": {
      const { item, output_index } =
        event as Extract<ResponseStreamEvent, { type: "response.output_item.added" }>;
      if (item.type !== "function_call") return [];

      state.toolCallIndex++;
      state.functionCallIndices.set(output_index, state.toolCallIndex);

      return [makeChunk(state, {
        tool_calls: [{
          index: state.toolCallIndex,
          id: item.call_id,
          type: "function",
          function: {
            name: item.name,
            arguments: "",
          },
        }],
      })];
    }

    case "response.output_item.done": {
      const { item } =
        event as Extract<ResponseStreamEvent, { type: "response.output_item.done" }>;
      return item.type === "reasoning" && item.encrypted_content
        ? [makeChunk(state, { reasoning_opaque: item.encrypted_content })]
        : [];
    }

    case "response.reasoning_summary_text.delta": {
      const { delta } =
        event as Extract<ResponseStreamEvent, { type: "response.reasoning_summary_text.delta" }>;
      return [makeChunk(state, { reasoning_text: delta })];
    }

    case "response.output_text.delta": {
      const { delta } =
        event as Extract<ResponseStreamEvent, { type: "response.output_text.delta" }>;
      return delta ? [makeChunk(state, { content: delta })] : [];
    }

    case "response.function_call_arguments.delta": {
      const { delta, output_index } =
        event as Extract<ResponseStreamEvent, { type: "response.function_call_arguments.delta" }>;
      if (!delta) return [];

      const toolCallIndex = state.functionCallIndices.get(output_index);
      if (toolCallIndex === undefined) return [];

      return [makeChunk(state, {
        tool_calls: [{
          index: toolCallIndex,
          function: { arguments: delta },
        }],
      })];
    }

    case "response.completed":
    case "response.incomplete": {
      const { response } =
        event as Extract<ResponseStreamEvent, { type: "response.completed" | "response.incomplete" }>;
      const chunk = makeChunk(state, {}, mapFinishReason(response));

      if (response.usage) {
        chunk.usage = {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens,
          total_tokens: response.usage.total_tokens,
          ...(response.usage.input_tokens_details?.cached_tokens !== undefined
            ? {
              prompt_tokens_details: {
                cached_tokens: response.usage.input_tokens_details.cached_tokens,
              },
            }
            : {}),
        };
      }

      state.done = true;
      return [chunk];
    }

    case "response.failed":
      state.done = true;
      return [];

    default:
      return [];
  }
};

const makeChunk = (
  state: ResponsesToChatCompletionsStreamState,
  delta: Delta,
  finishReason: ChatCompletionChunk["choices"][0]["finish_reason"] = null,
): ChatCompletionChunk => ({
  id: state.messageId,
  object: "chat.completion.chunk",
  created: state.created,
  model: state.model,
  choices: [{
    index: 0,
    delta,
    finish_reason: finishReason,
  }],
});
