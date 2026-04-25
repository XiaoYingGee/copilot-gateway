import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { SseFrame } from "./types.ts";

interface ProxySSEOptions {
  onError?: (error: unknown) => SseFrame;
}

export const proxySSE = (
  c: Context,
  events: AsyncIterable<SseFrame>,
  options: ProxySSEOptions = {},
): Response =>
  streamSSE(c, async (stream) => {
    try {
      for await (const event of events) {
        await stream.writeSSE({
          event: event.event,
          data: event.data,
        });
      }
    } catch (error) {
      if (!options.onError) throw error;

      const event = options.onError(error);
      await stream.writeSSE({
        event: event.event,
        data: event.data,
      });
    }
  });
