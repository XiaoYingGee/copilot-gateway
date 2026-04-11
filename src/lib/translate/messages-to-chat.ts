// Anthropic Messages → Chat Completions non-streaming response translation

import type {
  AnthropicResponse,
  AnthropicRedactedThinkingBlock,
  AnthropicThinkingBlock,
} from "../anthropic-types.ts";
import type {
  ChatCompletionResponse,
  ChoiceNonStreaming,
  ToolCall,
} from "../openai-types.ts";

export function translateMessagesToChatCompletion(
  resp: AnthropicResponse,
): ChatCompletionResponse {
  const textParts: string[] = [];
  const toolCalls: ToolCall[] = [];
  let reasoningText: string | undefined;
  let reasoningOpaque: string | undefined;

  for (const block of resp.content) {
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
        // Take the first thinking block
        if (!reasoningText) {
          reasoningText = (block as AnthropicThinkingBlock).thinking;
          if ((block as AnthropicThinkingBlock).signature) {
            reasoningOpaque = (block as AnthropicThinkingBlock).signature;
          }
        }
        break;
      case "redacted_thinking":
        // Only use redacted_thinking if no thinking block was found
        if (!reasoningText && !reasoningOpaque) {
          reasoningOpaque = (block as AnthropicRedactedThinkingBlock).data;
        }
        break;
    }
  }

  const content = textParts.join("") || null;

  const message: ChoiceNonStreaming["message"] = {
    role: "assistant",
    content,
  };

  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  if (reasoningText) message.reasoning_text = reasoningText;
  if (reasoningOpaque) message.reasoning_opaque = reasoningOpaque;

  const promptTokens =
    resp.usage.input_tokens + (resp.usage.cache_read_input_tokens ?? 0) + (resp.usage.cache_creation_input_tokens ?? 0);
  const completionTokens = resp.usage.output_tokens;

  return {
    id: resp.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: resp.model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: mapStopReason(resp.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      ...(resp.usage.cache_read_input_tokens != null && {
        prompt_tokens_details: {
          cached_tokens: resp.usage.cache_read_input_tokens,
        },
      }),
    },
  };
}

function mapStopReason(
  reason: AnthropicResponse["stop_reason"],
): ChoiceNonStreaming["finish_reason"] {
  switch (reason) {
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
}
