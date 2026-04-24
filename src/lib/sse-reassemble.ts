/**
 * SSE stream reassembly functions.
 *
 * When we force `stream: true` upstream, these functions consume the SSE
 * stream and reassemble the full non-streaming response object.
 */

import { parseSSEStream } from "./sse.ts";
import type {
  MessagesAssistantContentBlock,
  MessagesResponse,
} from "./messages-types.ts";
import type {
  ChatCompletionResponse,
  ChoiceNonStreaming,
  ToolCall,
} from "./chat-completions-types.ts";
import type { ResponsesResult } from "./responses-types.ts";

/** Check if an upstream response is SSE (vs plain JSON fallback). */
export function isSSEResponse(resp: Response): boolean {
  const ct = resp.headers.get("content-type") ?? "";
  return ct.includes("text/event-stream");
}

// ── Messages SSE → MessagesResponse ──

export async function reassembleMessagesSSE(
  body: ReadableStream<Uint8Array>,
): Promise<MessagesResponse> {
  let id = "";
  let model = "";
  let usage: MessagesResponse["usage"] = {
    input_tokens: 0,
    output_tokens: 0,
  };
  let stopReason: MessagesResponse["stop_reason"] = null;
  let stopSequence: string | null = null;

  // Accumulator per content block index
  const blocks: {
    type: string;
    text?: string;
    id?: string;
    name?: string;
    inputJson?: string;
    input?: Record<string, unknown>;
    thinking?: string;
    signature?: string;
    data?: string;
  }[] = [];

  for await (const raw of parseSSEStream(body)) {
    if (!raw.data) continue;
    const trimmed = raw.data.trim();
    if (trimmed === "[DONE]" || !trimmed) continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const type = event.type as string;

    if (type === "message_start") {
      const msg = event.message as Record<string, unknown>;
      id = msg.id as string;
      model = msg.model as string;
      if (msg.usage) {
        const u = msg.usage as Record<string, unknown>;
        usage = {
          input_tokens: (u.input_tokens as number) ?? 0,
          output_tokens: (u.output_tokens as number) ?? 0,
          ...(u.cache_creation_input_tokens != null && {
            cache_creation_input_tokens: u
              .cache_creation_input_tokens as number,
          }),
          ...(u.cache_read_input_tokens != null && {
            cache_read_input_tokens: u.cache_read_input_tokens as number,
          }),
          ...(u.service_tier != null && {
            service_tier: u.service_tier as "standard" | "priority" | "batch",
          }),
        };
      }
    } else if (type === "content_block_start") {
      const idx = event.index as number;
      const cb = event.content_block as Record<string, unknown>;
      const cbType = cb.type as string;
      if (cbType === "text") {
        blocks[idx] = { type: "text", text: (cb.text as string) ?? "" };
      } else if (cbType === "tool_use") {
        blocks[idx] = {
          type: "tool_use",
          id: cb.id as string,
          name: cb.name as string,
          inputJson: "",
        };
      } else if (cbType === "thinking") {
        blocks[idx] = {
          type: "thinking",
          thinking: (cb.thinking as string) ?? "",
          signature: "",
        };
      } else if (cbType === "redacted_thinking") {
        blocks[idx] = { type: "redacted_thinking", data: cb.data as string };
      }
    } else if (type === "content_block_delta") {
      const idx = event.index as number;
      const delta = event.delta as Record<string, unknown>;
      const deltaType = delta.type as string;
      const block = blocks[idx];
      if (!block) continue;

      if (deltaType === "text_delta" && block.type === "text") {
        block.text = (block.text ?? "") + (delta.text as string);
      } else if (
        deltaType === "input_json_delta" && block.type === "tool_use"
      ) {
        block.inputJson = (block.inputJson ?? "") +
          (delta.partial_json as string);
      } else if (deltaType === "thinking_delta" && block.type === "thinking") {
        block.thinking = (block.thinking ?? "") + (delta.thinking as string);
      } else if (
        deltaType === "signature_delta" && block.type === "thinking"
      ) {
        block.signature = (block.signature ?? "") +
          (delta.signature as string);
      }
    } else if (type === "content_block_stop") {
      const idx = event.index as number;
      const block = blocks[idx];
      if (block?.type === "tool_use" && block.inputJson) {
        try {
          block.input = JSON.parse(block.inputJson);
        } catch {
          block.input = {};
        }
      }
    } else if (type === "message_delta") {
      const delta = event.delta as Record<string, unknown>;
      if (delta.stop_reason != null) {
        stopReason = delta.stop_reason as MessagesResponse["stop_reason"];
      }
      if ("stop_sequence" in delta) {
        stopSequence = delta.stop_sequence as string | null;
      }
      if (event.usage) {
        const u = event.usage as Record<string, unknown>;
        if (u.output_tokens != null) {
          usage.output_tokens = u.output_tokens as number;
        }
        if (u.cache_creation_input_tokens != null) {
          usage.cache_creation_input_tokens = u
            .cache_creation_input_tokens as number;
        }
        if (u.cache_read_input_tokens != null) {
          usage.cache_read_input_tokens = u.cache_read_input_tokens as number;
        }
      }
    } else if (type === "error") {
      const err = event.error as Record<string, unknown>;
      throw new Error(
        `Upstream SSE error: ${err?.type ?? "unknown"}: ${
          err?.message ?? JSON.stringify(event)
        }`,
      );
    }
  }

  // Build final content blocks
  const content: MessagesAssistantContentBlock[] = [];
  for (const b of blocks) {
    if (!b) continue;
    if (b.type === "text") {
      content.push({ type: "text", text: b.text ?? "" });
    } else if (b.type === "tool_use") {
      content.push({
        type: "tool_use",
        id: b.id!,
        name: b.name!,
        input: b.input ?? {},
      });
    } else if (b.type === "thinking") {
      content.push({
        type: "thinking",
        thinking: b.thinking ?? "",
        signature: b.signature,
      });
    } else if (b.type === "redacted_thinking") {
      content.push({ type: "redacted_thinking", data: b.data! });
    }
  }

  return {
    id,
    type: "message",
    role: "assistant",
    content,
    model,
    stop_reason: stopReason,
    stop_sequence: stopSequence,
    usage,
  };
}

// ── Chat Completions SSE → ChatCompletionResponse ──

export async function reassembleChatCompletionsSSE(
  body: ReadableStream<Uint8Array>,
): Promise<ChatCompletionResponse> {
  let id = "";
  let model = "";
  let created = 0;
  let content = "";
  let reasoningText = "";
  let reasoningOpaque = "";
  let finishReason: ChoiceNonStreaming["finish_reason"] = "stop";
  let lastUsage: ChatCompletionResponse["usage"] | undefined;

  // tool_calls keyed by index
  const toolCallsMap = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  for await (const raw of parseSSEStream(body)) {
    if (!raw.data) continue;
    const trimmed = raw.data.trim();
    if (trimmed === "[DONE]" || !trimmed) continue;

    let chunk: Record<string, unknown>;
    try {
      chunk = JSON.parse(trimmed);
    } catch {
      continue;
    }

    // First chunk: capture top-level fields
    if (!id && chunk.id) {
      id = chunk.id as string;
      model = chunk.model as string;
      created = chunk.created as number;
    }

    if (chunk.usage) {
      lastUsage = chunk.usage as ChatCompletionResponse["usage"];
    }

    const choices = chunk.choices as
      | Array<Record<string, unknown>>
      | undefined;
    if (!choices) continue;

    for (const choice of choices) {
      const delta = choice.delta as Record<string, unknown> | undefined;
      if (!delta) continue;

      if (typeof delta.content === "string") {
        content += delta.content;
      }
      if (typeof delta.reasoning_text === "string") {
        reasoningText += delta.reasoning_text;
      }
      if (typeof delta.reasoning_opaque === "string") {
        reasoningOpaque += delta.reasoning_opaque;
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls as Array<Record<string, unknown>>) {
          const idx = tc.index as number;
          const existing = toolCallsMap.get(idx);
          if (!existing) {
            toolCallsMap.set(idx, {
              id: (tc.id as string) ?? "",
              name: (tc.function as Record<string, unknown>)?.name as string ??
                "",
              arguments:
                (tc.function as Record<string, unknown>)?.arguments as string ??
                  "",
            });
          } else {
            if (tc.id) existing.id = tc.id as string;
            const fn = tc.function as Record<string, unknown> | undefined;
            if (fn?.name) existing.name = fn.name as string;
            if (fn?.arguments) {
              existing.arguments += fn.arguments as string;
            }
          }
        }
      }

      if (choice.finish_reason) {
        finishReason = choice
          .finish_reason as ChoiceNonStreaming["finish_reason"];
      }
    }
  }

  // Build tool_calls array sorted by index
  const toolCalls: ToolCall[] = [];
  const sortedIndices = [...toolCallsMap.keys()].sort((a, b) => a - b);
  for (const idx of sortedIndices) {
    const tc = toolCallsMap.get(idx)!;
    toolCalls.push({
      id: tc.id,
      type: "function",
      function: { name: tc.name, arguments: tc.arguments },
    });
  }

  const message: ChoiceNonStreaming["message"] = {
    role: "assistant",
    content: content || null,
    ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
    ...(reasoningText && { reasoning_text: reasoningText }),
    ...(reasoningOpaque && { reasoning_opaque: reasoningOpaque }),
  };

  const result: ChatCompletionResponse = {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason,
      },
    ],
    ...(lastUsage && { usage: lastUsage }),
  };

  return result;
}

// ── Responses SSE → ResponsesResult ──

export async function reassembleResponsesSSE(
  body: ReadableStream<Uint8Array>,
): Promise<ResponsesResult> {
  for await (const raw of parseSSEStream(body)) {
    if (!raw.data) continue;
    const trimmed = raw.data.trim();
    if (!trimmed) continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    // Use the event name from SSE if the JSON body doesn't have "type"
    const type = (event.type as string) ||
      (raw.event as string);

    if (type === "error") {
      const message = (event.message as string) ?? JSON.stringify(event);
      throw new Error(`Upstream SSE error: ${message}`);
    }

    if (
      type === "response.completed" || type === "response.incomplete" ||
      type === "response.failed"
    ) {
      return event.response as ResponsesResult;
    }
  }

  throw new Error("SSE stream ended without a terminal response event");
}
