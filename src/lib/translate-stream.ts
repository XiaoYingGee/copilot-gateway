// Streaming translation: OpenAI SSE chunks → Anthropic SSE events

import type {
  AnthropicStreamEventData,
  AnthropicStreamState,
} from "./anthropic-types.ts";
import type { ChatCompletionChunk } from "./openai-types.ts";
import { mapStopReason } from "./stop-reason.ts";

function isToolBlockOpen(state: AnthropicStreamState): boolean {
  if (!state.contentBlockOpen) return false;
  return Object.values(state.toolCalls).some(
    (tc) => tc.anthropicBlockIndex === state.contentBlockIndex,
  );
}

export function translateChunkToAnthropicEvents(
  chunk: ChatCompletionChunk,
  state: AnthropicStreamState,
): AnthropicStreamEventData[] {
  const events: AnthropicStreamEventData[] = [];

  if (chunk.choices.length === 0) return events;

  const choice = chunk.choices[0];
  const { delta } = choice;

  // message_start
  if (!state.messageStartSent) {
    events.push({
      type: "message_start",
      message: {
        id: chunk.id,
        type: "message",
        role: "assistant",
        content: [],
        model: chunk.model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens:
            (chunk.usage?.prompt_tokens ?? 0) -
            (chunk.usage?.prompt_tokens_details?.cached_tokens ?? 0),
          output_tokens: 0,
          ...(chunk.usage?.prompt_tokens_details?.cached_tokens !== undefined && {
            cache_read_input_tokens:
              chunk.usage.prompt_tokens_details.cached_tokens,
          }),
        },
      },
    });
    state.messageStartSent = true;
  }

  // text content
  if (delta.content) {
    if (isToolBlockOpen(state)) {
      events.push({ type: "content_block_stop", index: state.contentBlockIndex });
      state.contentBlockIndex++;
      state.contentBlockOpen = false;
    }
    if (!state.contentBlockOpen) {
      events.push({
        type: "content_block_start",
        index: state.contentBlockIndex,
        content_block: { type: "text", text: "" },
      });
      state.contentBlockOpen = true;
    }
    events.push({
      type: "content_block_delta",
      index: state.contentBlockIndex,
      delta: { type: "text_delta", text: delta.content },
    });
  }

  // tool calls
  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      if (tc.id && tc.function?.name) {
        if (state.contentBlockOpen) {
          events.push({ type: "content_block_stop", index: state.contentBlockIndex });
          state.contentBlockIndex++;
          state.contentBlockOpen = false;
        }
        const blockIdx = state.contentBlockIndex;
        state.toolCalls[tc.index] = {
          id: tc.id,
          name: tc.function.name,
          anthropicBlockIndex: blockIdx,
        };
        events.push({
          type: "content_block_start",
          index: blockIdx,
          content_block: {
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input: {},
          },
        });
        state.contentBlockOpen = true;
      }
      if (tc.function?.arguments) {
        const info = state.toolCalls[tc.index];
        if (info) {
          events.push({
            type: "content_block_delta",
            index: info.anthropicBlockIndex,
            delta: { type: "input_json_delta", partial_json: tc.function.arguments },
          });
        }
      }
    }
  }

  // finish
  if (choice.finish_reason) {
    if (state.contentBlockOpen) {
      events.push({ type: "content_block_stop", index: state.contentBlockIndex });
      state.contentBlockOpen = false;
    }
    events.push(
      {
        type: "message_delta",
        delta: {
          stop_reason: mapStopReason(choice.finish_reason),
          stop_sequence: null,
        },
        usage: {
          input_tokens:
            (chunk.usage?.prompt_tokens ?? 0) -
            (chunk.usage?.prompt_tokens_details?.cached_tokens ?? 0),
          output_tokens: chunk.usage?.completion_tokens ?? 0,
          ...(chunk.usage?.prompt_tokens_details?.cached_tokens !== undefined && {
            cache_read_input_tokens:
              chunk.usage.prompt_tokens_details.cached_tokens,
          }),
        },
      },
      { type: "message_stop" },
    );
  }

  return events;
}
