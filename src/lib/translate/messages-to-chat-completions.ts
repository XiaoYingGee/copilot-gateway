import type {
  ChatCompletionResponse,
  ChatCompletionsPayload,
  ContentPart,
  Message,
  Tool,
  ToolCall,
} from "../chat-completions-types.ts";
import type {
  MessagesAssistantContentBlock,
  MessagesAssistantMessage,
  MessagesClientTool,
  MessagesMessage,
  MessagesPayload,
  MessagesRedactedThinkingBlock,
  MessagesResponse,
  MessagesServerToolUseBlock,
  MessagesTextBlock,
  MessagesToolResultBlock,
  MessagesWebSearchToolResultBlock,
  MessagesToolUseBlock,
  MessagesUserContentBlock,
  MessagesUserMessage,
} from "../messages-types.ts";

const toChatCompletionsContent = (
  content: string | MessagesUserContentBlock[] | MessagesAssistantContentBlock[],
): string | ContentPart[] | null => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;

  if (!content.some((block) => block.type === "image")) {
    return content
      .filter((block): block is MessagesTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n\n");
  }

  const parts: ContentPart[] = [];

  for (const block of content) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
      continue;
    }

    if (block.type !== "image") continue;

    parts.push({
      type: "image_url",
      image_url: {
        url: `data:${block.source.media_type};base64,${block.source.data}`,
      },
    });
  }

  return parts;
};

const toChatCompletionsToolResultContent = (
  content: MessagesToolResultBlock["content"],
): string => {
  if (typeof content === "string") {
    return content;
  }

  const textBlocks = content.filter((block): block is MessagesTextBlock =>
    block.type === "text"
  );
  if (textBlocks.length === content.length) {
    return textBlocks.map((block) => block.text).join("\n\n");
  }

  return JSON.stringify(content);
};

const toChatCompletionsFunctionCall = (
  block: MessagesToolUseBlock | MessagesServerToolUseBlock,
): ToolCall => ({
  id: block.id,
  type: "function",
  function: {
    name: block.name,
    arguments: JSON.stringify(block.input),
  },
});

const toChatCompletionsStructuredToolOutput = (
  block: MessagesWebSearchToolResultBlock,
): string => JSON.stringify(block.content);

type PendingAssistantMessage = {
  textParts: string[];
  toolCalls: ToolCall[];
  reasoningTextParts: string[];
  reasoningOpaque: string;
  hasReasoningOpaque: boolean;
  hasThinkingReasoningOpaque: boolean;
};

const createPendingAssistantMessage = (): PendingAssistantMessage => ({
  textParts: [],
  toolCalls: [],
  reasoningTextParts: [],
  reasoningOpaque: "",
  hasReasoningOpaque: false,
  hasThinkingReasoningOpaque: false,
});

const flushPendingAssistantMessage = (
  messages: Message[],
  pending: PendingAssistantMessage,
): void => {
  if (
    pending.textParts.length === 0 && pending.toolCalls.length === 0 &&
    pending.reasoningTextParts.length === 0 && !pending.hasReasoningOpaque
  ) {
    return;
  }

  messages.push({
    role: "assistant",
    content: pending.textParts.join("\n\n") || null,
    ...(pending.toolCalls.length > 0 ? { tool_calls: [...pending.toolCalls] } : {}),
    ...(pending.reasoningTextParts.length > 0
      ? { reasoning_text: pending.reasoningTextParts.join("\n\n") }
      : {}),
    ...(pending.hasReasoningOpaque
      ? { reasoning_opaque: pending.reasoningOpaque }
      : {}),
  });

  pending.textParts.length = 0;
  pending.toolCalls.length = 0;
  pending.reasoningTextParts.length = 0;
  pending.reasoningOpaque = "";
  pending.hasReasoningOpaque = false;
  pending.hasThinkingReasoningOpaque = false;
};

const getClientTools = (
  tools?: MessagesPayload["tools"],
): MessagesClientTool[] | undefined => {
  if (!tools) return undefined;

  const clientTools = tools.filter((tool): tool is MessagesClientTool =>
    tool.type === undefined || tool.type === "custom"
  );
  return clientTools.length > 0 ? clientTools : undefined;
};

const translateMessagesUser = (message: MessagesUserMessage): Message[] => {
  if (!Array.isArray(message.content)) {
    return [{ role: "user", content: toChatCompletionsContent(message.content) }];
  }

  const messages: Message[] = [];
  const toolResults = message.content.filter((block): block is MessagesToolResultBlock =>
    block.type === "tool_result"
  );
  const otherBlocks = message.content.filter((block) => block.type !== "tool_result");

  for (const toolResult of toolResults) {
    messages.push({
      role: "tool",
      tool_call_id: toolResult.tool_use_id,
      content: toChatCompletionsToolResultContent(toolResult.content),
    });
  }

  if (otherBlocks.length > 0) {
    messages.push({
      role: "user",
      content: toChatCompletionsContent(otherBlocks),
    });
  }

  return messages;
};

const translateMessagesAssistant = (
  message: MessagesAssistantMessage,
): Message[] => {
  if (!Array.isArray(message.content)) {
    return [{
      role: "assistant",
      content: toChatCompletionsContent(message.content),
    }];
  }

  const messages: Message[] = [];
  const pending = createPendingAssistantMessage();

  for (const block of message.content) {
    if (block.type === "text") {
      pending.textParts.push(block.text);
      continue;
    }

    if (block.type === "thinking") {
      pending.reasoningTextParts.push(block.thinking);
      if (
        Object.hasOwn(block, "signature") &&
        !pending.hasThinkingReasoningOpaque
      ) {
        pending.reasoningOpaque = block.signature as string;
        pending.hasReasoningOpaque = true;
        pending.hasThinkingReasoningOpaque = true;
      }
      continue;
    }

    if (block.type === "redacted_thinking") {
      if (pending.reasoningTextParts.length === 0 && !pending.hasReasoningOpaque) {
        pending.reasoningOpaque = (block as MessagesRedactedThinkingBlock).data;
        pending.hasReasoningOpaque = true;
      }
      continue;
    }

    if (block.type === "tool_use" || block.type === "server_tool_use") {
      pending.toolCalls.push(toChatCompletionsFunctionCall(block));
      continue;
    }

    flushPendingAssistantMessage(messages, pending);
    messages.push({
      role: "tool",
      tool_call_id: block.tool_use_id,
      content: toChatCompletionsStructuredToolOutput(block),
    });
  }

  flushPendingAssistantMessage(messages, pending);
  return messages;
};

const translateMessagesInput = (
  messages: MessagesMessage[],
  system: string | MessagesTextBlock[] | undefined,
): Message[] => {
  const systemMessages: Message[] = system
    ? [{
      role: "system",
      content: typeof system === "string"
        ? system
        : system.map((block) => block.text).join("\n\n"),
    }]
    : [];

  return [
    ...systemMessages,
    ...messages.flatMap((message) =>
      message.role === "user"
        ? translateMessagesUser(message)
        : translateMessagesAssistant(message)
    ),
  ];
};

const translateMessagesTools = (
  tools?: MessagesClientTool[],
): Tool[] | undefined =>
  tools?.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
      ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
    },
  }));

const translateMessagesToolChoice = (
  toolChoice?: MessagesPayload["tool_choice"],
  tools?: MessagesClientTool[],
): ChatCompletionsPayload["tool_choice"] => {
  if (!toolChoice || !tools || tools.length === 0) return undefined;

  const toolNames = new Set(tools.map((tool) => tool.name));

  switch (toolChoice.type) {
    case "auto":
      return "auto";
    case "any":
      return "required";
    case "tool":
      return toolChoice.name && toolNames.has(toolChoice.name)
        ? { type: "function", function: { name: toolChoice.name } }
        : undefined;
    case "none":
      return "none";
    default:
      return undefined;
  }
};

export const translateMessagesToChatCompletions = (
  payload: MessagesPayload,
): ChatCompletionsPayload => {
  const clientTools = getClientTools(payload.tools);

  return {
    model: payload.model,
    messages: translateMessagesInput(payload.messages, payload.system),
    max_tokens: payload.max_tokens,
    stop: payload.stop_sequences,
    stream: payload.stream,
    ...(payload.stream ? { stream_options: { include_usage: true } } : {}),
    temperature: payload.temperature,
    top_p: payload.top_p,
    user: payload.metadata?.user_id,
    tools: translateMessagesTools(clientTools),
    tool_choice: translateMessagesToolChoice(payload.tool_choice, clientTools),
  };
};

export const mapMessagesStopReasonToChatCompletionsFinishReason = (
  stopReason: MessagesResponse["stop_reason"],
): ChatCompletionResponse["choices"][0]["finish_reason"] => {
  switch (stopReason) {
    case "end_turn":
    case "stop_sequence":
    case "pause_turn":
    case "refusal":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return "stop";
  }
};

export const translateMessagesToChatCompletionsResponse = (
  response: MessagesResponse,
): ChatCompletionResponse => {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  const preservedUnsupportedHistory: MessagesAssistantContentBlock[] = [];
  const reasoningTextParts: string[] = [];
  let reasoningOpaque: string | undefined;
  let hasReasoningOpaque = false;
  let hasThinkingReasoningOpaque = false;

  for (const block of response.content) {
    switch (block.type) {
      case "text":
        textParts.push(block.text);
        break;
      case "tool_use":
        toolCalls.push({
          id: block.id,
          type: "function",
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
        break;
      case "thinking":
        reasoningTextParts.push(block.thinking);
        if (
          Object.hasOwn(block, "signature") &&
          !hasThinkingReasoningOpaque
        ) {
          reasoningOpaque = block.signature as string;
          hasReasoningOpaque = true;
          hasThinkingReasoningOpaque = true;
        }
        break;
      case "redacted_thinking":
        if (reasoningTextParts.length === 0 && !hasReasoningOpaque) {
          reasoningOpaque = (block as MessagesRedactedThinkingBlock).data;
          hasReasoningOpaque = true;
        }
        break;
      case "server_tool_use":
      case "web_search_tool_result":
        preservedUnsupportedHistory.push(block);
        break;
    }
  }

  if (preservedUnsupportedHistory.length > 0) {
    textParts.push(JSON.stringify(preservedUnsupportedHistory));
  }

  const reasoningText = reasoningTextParts.length > 0
    ? reasoningTextParts.join("\n\n")
    : undefined;

  const promptTokens =
    response.usage.input_tokens +
    (response.usage.cache_read_input_tokens ?? 0) +
    (response.usage.cache_creation_input_tokens ?? 0);
  const completionTokens = response.usage.output_tokens;

  return {
    id: response.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: textParts.join("") || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        ...(reasoningText ? { reasoning_text: reasoningText } : {}),
        ...(hasReasoningOpaque ? { reasoning_opaque: reasoningOpaque } : {}),
      },
      finish_reason: mapMessagesStopReasonToChatCompletionsFinishReason(
        response.stop_reason,
      ),
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      ...(response.usage.cache_read_input_tokens != null
        ? {
          prompt_tokens_details: {
            cached_tokens: response.usage.cache_read_input_tokens,
          },
        }
        : {}),
    },
  };
};
