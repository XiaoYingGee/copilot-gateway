import { assertEquals, assertRejects } from "@std/assert";
import { eventFrame } from "../../../shared/stream/types.ts";
import type { SourceResponseStreamEvent } from "./protocol.ts";
import { responsesProtocolEventsToSSEFrames } from "./to-sse.ts";

const collect = async <T>(events: AsyncIterable<T>): Promise<T[]> => {
  const collected: T[] = [];
  for await (const event of events) collected.push(event);
  return collected;
};

Deno.test("responsesProtocolEventsToSSEFrames stops at terminal events", async () => {
  const terminal = {
    type: "response.completed",
    sequence_number: 0,
    response: {
      id: "resp_done",
      object: "response",
      model: "gpt-test",
      status: "completed",
      output: [],
      output_text: "",
    },
  } satisfies SourceResponseStreamEvent;

  const frames = await collect(
    responsesProtocolEventsToSSEFrames((async function* () {
      yield eventFrame(terminal);
      yield eventFrame(
        {
          type: "response.output_text.delta",
          sequence_number: 1,
          item_id: "msg_1",
          output_index: 0,
          content_index: 0,
          delta: "ignored",
        } satisfies SourceResponseStreamEvent,
      );
    })()),
  );

  assertEquals(frames.map((frame) => frame.event), ["response.completed"]);
});

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
