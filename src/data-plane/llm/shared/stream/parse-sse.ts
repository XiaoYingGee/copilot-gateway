import { type SseFrame, sseFrame } from "./types.ts";

export const parseSSEStream = async function* (
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";

  const readLine = (rawLine: string): SseFrame | null => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
      return null;
    }

    if (line.startsWith("data: ")) {
      const frame = sseFrame(line.slice(6), currentEvent || undefined);
      currentEvent = "";
      return frame;
    }

    return null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const frame = readLine(line);
        if (frame) yield frame;
      }
    }

    if (buffer) {
      const lines = buffer.split("\n");
      buffer = "";
      for (const line of lines) {
        const frame = readLine(line);
        if (frame) yield frame;
      }
    }
  } finally {
    await reader.cancel();
  }
};
