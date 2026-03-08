// Anthropic ↔ OpenAI translation layer (non-streaming)
// Ported from copilot-api with minimal changes

import type {
  AnthropicAssistantContentBlock,
  AnthropicAssistantMessage,
  AnthropicMessage,
  AnthropicMessagesPayload,
  AnthropicResponse,
  AnthropicTextBlock,
  AnthropicThinkingBlock,
  AnthropicToolResultBlock,
  AnthropicToolUseBlock,
  AnthropicUserContentBlock,
  AnthropicUserMessage,
} from "./anthropic-types.ts";

import type {
  ChatCompletionResponse,
  ChatCompletionsPayload,
  ContentPart,
  Message,
  TextPart,
  Tool,
  ToolCall,
} from "./openai-types.ts";

import { mapStopReason } from "./stop-reason.ts";

// ── Request: Anthropic → OpenAI ──

export function translateToOpenAI(
  payload: AnthropicMessagesPayload,
): ChatCompletionsPayload {
  return {
    model: translateModelName(payload.model),
    messages: translateMessages(payload.messages, payload.system),
    max_tokens: payload.max_tokens,
    stop: payload.stop_sequences,
    stream: payload.stream,
    temperature: payload.temperature,
    top_p: payload.top_p,
    user: payload.metadata?.user_id,
    tools: translateTools(payload.tools),
    tool_choice: translateToolChoice(payload.tool_choice),
  };
}

function translateModelName(model: string): string {
  if (model.startsWith("claude-sonnet-4-")) {
    return model.replace(/^claude-sonnet-4-.*/, "claude-sonnet-4");
  } else if (model.startsWith("claude-opus-4-")) {
    return model.replace(/^claude-opus-4-.*/, "claude-opus-4");
  }
  return model;
}

function translateMessages(
  msgs: AnthropicMessage[],
  system: string | AnthropicTextBlock[] | undefined,
): Message[] {
  const systemMsgs: Message[] = [];
  if (system) {
    const text =
      typeof system === "string"
        ? system
        : system.map((b) => b.text).join("\n\n");
    systemMsgs.push({ role: "system", content: text });
  }

  const otherMsgs = msgs.flatMap((m) =>
    m.role === "user" ? handleUser(m) : handleAssistant(m),
  );

  return [...systemMsgs, ...otherMsgs];
}

function handleUser(msg: AnthropicUserMessage): Message[] {
  const result: Message[] = [];
  if (Array.isArray(msg.content)) {
    const toolResults = msg.content.filter(
      (b): b is AnthropicToolResultBlock => b.type === "tool_result",
    );
    const others = msg.content.filter((b) => b.type !== "tool_result");

    for (const tr of toolResults) {
      result.push({
        role: "tool",
        tool_call_id: tr.tool_use_id,
        content: mapContent(tr.content),
      });
    }
    if (others.length > 0) {
      result.push({ role: "user", content: mapContent(others) });
    }
  } else {
    result.push({ role: "user", content: mapContent(msg.content) });
  }
  return result;
}

function handleAssistant(msg: AnthropicAssistantMessage): Message[] {
  if (!Array.isArray(msg.content)) {
    return [{ role: "assistant", content: mapContent(msg.content) }];
  }

  const toolUses = msg.content.filter(
    (b): b is AnthropicToolUseBlock => b.type === "tool_use",
  );
  const texts = msg.content.filter(
    (b): b is AnthropicTextBlock => b.type === "text",
  );
  const thinking = msg.content.filter(
    (b): b is AnthropicThinkingBlock => b.type === "thinking",
  );

  const allText = [...texts.map((b) => b.text), ...thinking.map((b) => b.thinking)]
    .join("\n\n");

  if (toolUses.length > 0) {
    return [
      {
        role: "assistant",
        content: allText || null,
        tool_calls: toolUses.map((tu) => ({
          id: tu.id,
          type: "function" as const,
          function: {
            name: tu.name,
            arguments: JSON.stringify(tu.input),
          },
        })),
      },
    ];
  }

  return [{ role: "assistant", content: mapContent(msg.content) }];
}

function mapContent(
  content: string | (AnthropicUserContentBlock | AnthropicAssistantContentBlock)[],
): string | ContentPart[] | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;

  const hasImage = content.some((b) => b.type === "image");
  if (!hasImage) {
    return content
      .filter(
        (b): b is AnthropicTextBlock | AnthropicThinkingBlock =>
          b.type === "text" || b.type === "thinking",
      )
      .map((b) => (b.type === "text" ? b.text : b.thinking))
      .join("\n\n");
  }

  const parts: ContentPart[] = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "thinking") {
      parts.push({ type: "text", text: block.thinking });
    } else if (block.type === "image") {
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`,
        },
      });
    }
  }
  return parts;
}

function translateTools(tools?: AnthropicMessagesPayload["tools"]): Tool[] | undefined {
  if (!tools) return undefined;
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function translateToolChoice(
  tc?: AnthropicMessagesPayload["tool_choice"],
): ChatCompletionsPayload["tool_choice"] {
  if (!tc) return undefined;
  switch (tc.type) {
    case "auto":
      return "auto";
    case "any":
      return "required";
    case "tool":
      return tc.name
        ? { type: "function", function: { name: tc.name } }
        : undefined;
    case "none":
      return "none";
    default:
      return undefined;
  }
}

// ── Response: OpenAI → Anthropic ──

export function translateToAnthropic(
  resp: ChatCompletionResponse,
): AnthropicResponse {
  const allTextBlocks: AnthropicTextBlock[] = [];
  const allToolBlocks: AnthropicToolUseBlock[] = [];
  let stopReason = resp.choices[0]?.finish_reason ?? null;

  for (const choice of resp.choices) {
    if (choice.message.content) {
      allTextBlocks.push({ type: "text", text: choice.message.content });
    }
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        allToolBlocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        });
      }
    }
    if (choice.finish_reason === "tool_calls" || stopReason === "stop") {
      stopReason = choice.finish_reason;
    }
  }

  return {
    id: resp.id,
    type: "message",
    role: "assistant",
    model: resp.model,
    content: [...allTextBlocks, ...allToolBlocks],
    stop_reason: mapStopReason(stopReason),
    stop_sequence: null,
    usage: {
      input_tokens:
        (resp.usage?.prompt_tokens ?? 0) -
        (resp.usage?.prompt_tokens_details?.cached_tokens ?? 0),
      output_tokens: resp.usage?.completion_tokens ?? 0,
      ...(resp.usage?.prompt_tokens_details?.cached_tokens !== undefined && {
        cache_read_input_tokens:
          resp.usage.prompt_tokens_details.cached_tokens,
      }),
    },
  };
}
