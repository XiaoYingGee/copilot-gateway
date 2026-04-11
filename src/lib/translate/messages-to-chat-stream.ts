// Anthropic SSE → Chat Completions chunks streaming translation

import type {
  AnthropicStreamEventData,
  AnthropicResponse,
} from "../anthropic-types.ts";
import type { ChatCompletionChunk, Delta } from "../openai-types.ts";

export interface ChatStreamState {
  messageId: string;
  model: string;
  created: number;
  toolCallIndex: number;
  currentBlockType: string;
  currentToolCallId: string;
  currentToolCallName: string;
  inputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export function createChatStreamState(): ChatStreamState {
  return {
    messageId: "",
    model: "",
    created: Math.floor(Date.now() / 1000),
    toolCallIndex: -1,
    currentBlockType: "",
    currentToolCallId: "",
    currentToolCallName: "",
    inputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
}

/**
 * Translate an Anthropic stream event to Chat Completions chunks.
 * Returns an array of chunks to emit, or "DONE" to signal end of stream.
 */
export function translateAnthropicEventToChatChunks(
  event: AnthropicStreamEventData,
  state: ChatStreamState,
): ChatCompletionChunk[] | "DONE" {
  switch (event.type) {
    case "message_start": {
      state.messageId = event.message.id;
      state.model = event.message.model;
      state.inputTokens = event.message.usage.input_tokens;
      state.cacheReadInputTokens = event.message.usage.cache_read_input_tokens ?? 0;
      state.cacheCreationInputTokens = event.message.usage.cache_creation_input_tokens ?? 0;
      return [makeChunk(state, { role: "assistant" })];
    }

    case "content_block_start": {
      const block = event.content_block;
      state.currentBlockType = block.type;

      if (block.type === "redacted_thinking") {
        // Emit entire redacted_thinking data at once, no subsequent deltas
        return [makeChunk(state, { reasoning_opaque: block.data })];
      }

      if (block.type === "tool_use") {
        state.toolCallIndex++;
        state.currentToolCallId = block.id;
        state.currentToolCallName = block.name;
        return [
          makeChunk(state, {
            tool_calls: [
              {
                index: state.toolCallIndex,
                id: block.id,
                type: "function",
                function: { name: block.name, arguments: "" },
              },
            ],
          }),
        ];
      }

      // thinking and text: wait for deltas
      return [];
    }

    case "content_block_delta": {
      const delta = event.delta;

      if (delta.type === "thinking_delta") {
        return [makeChunk(state, { reasoning_text: delta.thinking })];
      }

      if (delta.type === "signature_delta") {
        return [makeChunk(state, { reasoning_opaque: delta.signature })];
      }

      if (delta.type === "text_delta") {
        return [makeChunk(state, { content: delta.text })];
      }

      if (delta.type === "input_json_delta") {
        return [
          makeChunk(state, {
            tool_calls: [
              {
                index: state.toolCallIndex,
                function: { arguments: delta.partial_json },
              },
            ],
          }),
        ];
      }

      return [];
    }

    case "content_block_stop":
      state.currentBlockType = "";
      return [];

    case "message_delta": {
      const finishReason = mapStopReason(event.delta.stop_reason ?? null);
      const chunk = makeChunk(state, {}, finishReason);

      if (event.usage) {
        const promptTokens = state.inputTokens + state.cacheReadInputTokens + state.cacheCreationInputTokens;
        const completionTokens = event.usage.output_tokens;
        chunk.usage = {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
          ...(state.cacheReadInputTokens > 0 && {
            prompt_tokens_details: { cached_tokens: state.cacheReadInputTokens },
          }),
        };
      }

      return [chunk];
    }

    case "message_stop":
      return "DONE";

    case "ping":
    case "error":
      return [];

    default:
      return [];
  }
}

function makeChunk(
  state: ChatStreamState,
  delta: Delta,
  finishReason: string | null = null,
): ChatCompletionChunk {
  return {
    id: state.messageId,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason as ChatCompletionChunk["choices"][0]["finish_reason"],
      },
    ],
  };
}

function mapStopReason(
  reason: AnthropicResponse["stop_reason"],
): string | null {
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
      return null;
  }
}
