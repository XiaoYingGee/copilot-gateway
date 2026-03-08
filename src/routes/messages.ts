// POST /v1/messages — Anthropic Messages API (translated to OpenAI and back)

import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { copilotFetch } from "../lib/copilot.ts";
import { getEnv } from "../middleware/auth.ts";
import type {
  AnthropicMessagesPayload,
  AnthropicStreamState,
} from "../lib/anthropic-types.ts";
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
} from "../lib/openai-types.ts";
import { translateToOpenAI, translateToAnthropic } from "../lib/translate.ts";
import { translateChunkToAnthropicEvents } from "../lib/translate-stream.ts";

export const messages = async (c: Context) => {
  try {
    const anthropicPayload = await c.req.json<AnthropicMessagesPayload>();
    const openAIPayload = translateToOpenAI(anthropicPayload);

    const resp = await copilotFetch(
      "/chat/completions",
      {
        method: "POST",
        body: JSON.stringify(openAIPayload),
      },
      getEnv("GITHUB_TOKEN"),
      getEnv("ACCOUNT_TYPE"),
    );

    if (!resp.ok) {
      const text = await resp.text();
      return c.json(
        { error: { type: "api_error", message: `Copilot API error: ${resp.status} ${text}` } },
        resp.status as 400 | 401 | 403 | 404 | 429 | 500 | 502 | 503,
      );
    }

    // Non-streaming
    if (!anthropicPayload.stream) {
      const openAIResponse = (await resp.json()) as ChatCompletionResponse;
      const anthropicResponse = translateToAnthropic(openAIResponse);
      return c.json(anthropicResponse);
    }

    // Streaming — read OpenAI SSE, translate to Anthropic SSE
    return streamSSE(c, async (stream) => {
      const state: AnthropicStreamState = {
        messageStartSent: false,
        contentBlockIndex: 0,
        contentBlockOpen: false,
        toolCalls: {},
      };

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          if (!data) continue;

          let chunk: ChatCompletionChunk;
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }

          const events = translateChunkToAnthropicEvents(chunk, state);
          for (const event of events) {
            await stream.writeSSE({
              event: event.type,
              data: JSON.stringify(event),
            });
          }
        }
      }
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json(
      { error: { type: "api_error", message: msg } },
      502,
    );
  }
};
