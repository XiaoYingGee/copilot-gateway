import { assertRejects } from "@std/assert";
import { eventFrame } from "../../../shared/stream/types.ts";
import {
  responsesProtocolEventsToSSEFrames,
  type SourceResponseStreamEvent,
} from "./to-sse.ts";

const collect = async <T>(events: AsyncIterable<T>): Promise<T[]> => {
  const collected: T[] = [];
  for await (const event of events) collected.push(event);
  return collected;
};

Deno.test("responsesProtocolEventsToSSEFrames rejects streams without terminal events", async () => {
  await assertRejects(
    async () => {
      await collect(responsesProtocolEventsToSSEFrames((async function* () {
        yield eventFrame(
          {
            type: "response.created",
            sequence_number: 0,
            response: {
              id: "resp_truncated",
              object: "response",
              model: "gpt-test",
              status: "in_progress",
              output: [],
              output_text: "",
            },
          } satisfies SourceResponseStreamEvent,
        );
      })()));
    },
    Error,
    "Responses stream ended without a terminal event.",
  );
});
