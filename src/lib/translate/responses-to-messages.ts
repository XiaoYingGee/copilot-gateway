import {
  MESSAGES_THINKING_PLACEHOLDER,
  type MessagesAssistantContentBlock,
  type MessagesAssistantMessage,
  type MessagesImageBlock,
  type MessagesMessage,
  type MessagesPayload,
  type MessagesResponse,
  type MessagesTargetPayload,
  type MessagesTool,
  type MessagesToolResultBlock,
  type MessagesUserContentBlock,
  type MessagesUserMessage,
} from "../messages-types.ts";
import type {
  ResponseInputImage,
  ResponseInputItem,
  ResponseInputMessage,
  ResponseInputText,
  ResponseOutputContentBlock,
  ResponseOutputItem,
  ResponsesPayload,
  ResponsesResult,
  ResponseTool,
  ResponseToolChoice,
} from "../responses-types.ts";
import { safeJsonParse } from "./utils.ts";

const combineMessageTextContent = (
  content: ResponseOutputContentBlock[] | undefined,
): string => {
  if (!Array.isArray(content)) return "";

  return content.map((block) => {
    if (block.type === "output_text") return block.text;
    if (block.type === "refusal") return block.refusal;
    return "";
  }).join("");
};

const mapOutputToMessagesContent = (
  output: ResponseOutputItem[],
): MessagesAssistantContentBlock[] => {
  const content: MessagesAssistantContentBlock[] = [];

  for (const item of output) {
    switch (item.type) {
      case "reasoning": {
        const thinking = item.summary?.length
          ? item.summary.map((part) => part.text).join("").trim()
          : MESSAGES_THINKING_PLACEHOLDER;

        if (thinking.length === 0) break;

        content.push({
          type: "thinking",
          thinking,
          signature: item.encrypted_content ?? "",
        });
        break;
      }
      case "function_call":
        if (item.name && item.call_id) {
          content.push({
            type: "tool_use",
            id: item.call_id,
            name: item.name,
            input: safeJsonParse(item.arguments),
          });
        }
        break;
      case "message": {
        const text = combineMessageTextContent(item.content);
        if (text.length > 0) content.push({ type: "text", text });
        break;
      }
    }
  }

  return content;
};

const mapResponsesStopReason = (
  response: ResponsesResult,
): MessagesResponse["stop_reason"] => {
  if (response.status === "completed") {
    return response.output.some((item) => item.type === "function_call")
      ? "tool_use"
      : "end_turn";
  }

  if (
    response.status === "incomplete" &&
    response.incomplete_details?.reason === "max_output_tokens"
  ) {
    return "max_tokens";
  }

  return null;
};

const extractSystemText = (
  message: ResponseInputMessage,
): string => {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";

  return message.content.map((block) => "text" in block ? block.text : "").join(
    "",
  );
};

const translateUserMessage = (
  message: ResponseInputMessage,
): MessagesUserMessage => {
  if (typeof message.content === "string") {
    return { role: "user", content: message.content };
  }

  const content: MessagesUserContentBlock[] = [];

  for (const block of message.content) {
    if (block.type === "input_text") {
      content.push({ type: "text", text: (block as ResponseInputText).text });
      continue;
    }

    if (block.type !== "input_image") continue;

    const match = (block as ResponseInputImage).image_url.match(
      /^data:(image\/[^;]+);base64,(.+)$/,
    );

    if (!match) continue;

    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: match[1] as MessagesImageBlock["source"]["media_type"],
        data: match[2],
      },
    });
  }

  return { role: "user", content: content.length > 0 ? content : "" };
};

const translateAssistantMessage = (
  message: ResponseInputMessage,
): MessagesAssistantMessage => {
  if (typeof message.content === "string") {
    return { role: "assistant", content: message.content };
  }

  const content: MessagesAssistantContentBlock[] = [];

  for (const block of message.content) {
    if (block.type === "output_text") {
      content.push({ type: "text", text: (block as ResponseInputText).text });
    }
  }

  return { role: "assistant", content: content.length > 0 ? content : "" };
};

const appendAssistantBlock = (
  messages: MessagesMessage[],
  block: MessagesAssistantContentBlock,
): void => {
  const lastMessage = messages[messages.length - 1];

  if (lastMessage?.role === "assistant" && Array.isArray(lastMessage.content)) {
    lastMessage.content.push(block);
    return;
  }

  messages.push({ role: "assistant", content: [block] });
};

const appendUserBlock = (
  messages: MessagesMessage[],
  block: MessagesToolResultBlock,
): void => {
  const lastMessage = messages[messages.length - 1];

  if (lastMessage?.role === "user" && Array.isArray(lastMessage.content)) {
    lastMessage.content.push(block);
    return;
  }

  messages.push({ role: "user", content: [block] });
};

const translateResponsesInput = (
  input: string | ResponseInputItem[],
): { messages: MessagesMessage[]; systemParts: string[] } => {
  if (typeof input === "string") {
    return {
      messages: [{ role: "user", content: input }],
      systemParts: [],
    };
  }

  const messages: MessagesMessage[] = [];
  const systemParts: string[] = [];

  for (const item of input) {
    switch (item.type) {
      case "message":
        if (item.role === "system" || item.role === "developer") {
          const text = extractSystemText(item);
          if (text) systemParts.push(text);
          continue;
        }

        messages.push(
          item.role === "user"
            ? translateUserMessage(item)
            : translateAssistantMessage(item),
        );
        break;
      case "function_call":
        appendAssistantBlock(messages, {
          type: "tool_use",
          id: item.call_id,
          name: item.name,
          input: safeJsonParse(item.arguments),
        });
        break;
      case "function_call_output":
        appendUserBlock(messages, {
          type: "tool_result",
          tool_use_id: item.call_id,
          content: item.output,
          is_error: item.status === "incomplete" ? true : undefined,
        });
        break;
      case "reasoning":
        appendAssistantBlock(messages, {
          type: "thinking",
          thinking: item.summary?.map((part) => part.text).join("") ||
            MESSAGES_THINKING_PLACEHOLDER,
          ...(item.encrypted_content
            ? { signature: item.encrypted_content }
            : {}),
        });
        break;
    }
  }

  return { messages, systemParts };
};

const translateTools = (
  tools: ResponseTool[] | null,
): MessagesTool[] | undefined => {
  if (!tools || tools.length === 0) return undefined;

  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
    strict: tool.strict,
  }));
};

const translateToolChoice = (
  toolChoice: ResponseToolChoice | undefined,
): MessagesPayload["tool_choice"] => {
  if (!toolChoice) return undefined;

  if (typeof toolChoice === "string") {
    switch (toolChoice) {
      case "auto":
        return { type: "auto" };
      case "none":
        return { type: "none" };
      case "required":
        return { type: "any" };
      default:
        return undefined;
    }
  }

  return toolChoice.type === "function" && toolChoice.name
    ? { type: "tool", name: toolChoice.name }
    : undefined;
};

export const translateResponsesToMessagesResponse = (
  response: ResponsesResult,
): MessagesResponse => {
  const content = mapOutputToMessagesContent(response.output);
  const finalContent = content.length > 0
    ? content
    : response.output_text
    ? [{ type: "text" as const, text: response.output_text }]
    : [];

  const inputTokens = response.usage?.input_tokens ?? 0;
  const cachedTokens = response.usage?.input_tokens_details?.cached_tokens;

  return {
    id: response.id,
    type: "message",
    role: "assistant",
    content: finalContent,
    model: response.model,
    stop_reason: mapResponsesStopReason(response),
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens - (cachedTokens ?? 0),
      output_tokens: response.usage?.output_tokens ?? 0,
      ...(cachedTokens !== undefined
        ? { cache_read_input_tokens: cachedTokens }
        : {}),
    },
  };
};

export const translateResponsesToMessages = (
  payload: ResponsesPayload,
): MessagesTargetPayload => {
  const { messages, systemParts } = translateResponsesInput(payload.input);
  const system = [payload.instructions, ...systemParts].filter((
    part,
  ): part is string => Boolean(part)).join("\n\n");
  const effort = payload.reasoning?.effort;

  return {
    model: payload.model,
    messages,
    ...(payload.max_output_tokens != null
      ? { max_tokens: payload.max_output_tokens }
      : {}),
    ...(system ? { system } : {}),
    ...(payload.temperature != null
      ? { temperature: payload.temperature }
      : {}),
    ...(payload.top_p != null ? { top_p: payload.top_p } : {}),
    ...(payload.stream != null ? { stream: payload.stream } : {}),
    tools: translateTools(payload.tools),
    tool_choice: translateToolChoice(payload.tool_choice),
    metadata: payload.metadata
      ? { ...payload.metadata } as { user_id?: string }
      : undefined,
    ...(effort === "none"
      ? { thinking: { type: "disabled" as const } }
      : effort
      ? { output_config: { effort } }
      : {}),
  };
};
