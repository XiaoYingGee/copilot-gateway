import { assertEquals } from "@std/assert";
import { parseSSEStream } from "./parse-sse.ts";

const collect = async (text: string) => {
  const frames = [];
  for await (const frame of parseSSEStream(new Response(text).body!)) {
    frames.push(frame);
  }
  return frames;
};

Deno.test("parseSSEStream flushes a final data line without a trailing newline", async () => {
  assertEquals(await collect("event: message_delta\ndata: not json"), [{
    type: "sse",
    event: "message_delta",
    data: "not json",
  }]);
});
