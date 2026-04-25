import { assertEquals } from "@std/assert";
import type {
  ResponsesResult,
  ResponseStreamEvent,
} from "../../../../lib/responses-types.ts";
import { eventFrame, type ProtocolFrame } from "../../shared/stream/types.ts";
import {
  responsesResultToEvents,
  type SequencedResponseStreamEvent,
} from "../../targets/responses/events/from-result.ts";
import { translateToSourceEvents } from "./translate-to-source-events.ts";

const makeResponse = (status: ResponsesResult["status"]): ResponsesResult => ({
  id: "resp_123",
  object: "response",
  model: "gpt-test",
  status,
  output_text: "hello",
  output: [{
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: "hello" }],
  }],
  usage: {
    input_tokens: 3,
    output_tokens: 2,
    total_tokens: 5,
  },
});

const toProtocolFrame = (
  event: ResponseStreamEvent,
): ProtocolFrame<SequencedResponseStreamEvent> =>
  eventFrame({ ...event, sequence_number: 0 });

Deno.test("translateToSourceEvents does not emit mixed frames for created+completed fallback", async () => {
  async function* stream() {
    yield toProtocolFrame({
      type: "response.created",
      response: makeResponse("in_progress"),
    });
    yield toProtocolFrame({
      type: "response.completed",
      response: makeResponse("completed"),
    });
  }

  const frames = [];

  for await (const frame of translateToSourceEvents(stream())) {
    frames.push(frame);
  }

  assertEquals(frames.map((frame) => frame.type), [
    "event",
    "event",
    "event",
    "event",
    "event",
    "event",
  ]);
  assertEquals(
    frames.map((frame) =>
      frame.type === "event" ? frame.event.type : frame.type
    ),
    [
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ],
  );
});

Deno.test("translateToSourceEvents preserves refusal text from JSON fallback", async () => {
  async function* stream() {
    yield* responsesResultToEvents({
      id: "resp_refusal",
      object: "response",
      model: "gpt-test",
      status: "completed",
      output_text: "",
      output: [{
        type: "message",
        role: "assistant",
        content: [{ type: "refusal", refusal: "No." }],
      }],
      usage: {
        input_tokens: 3,
        output_tokens: 1,
        total_tokens: 4,
      },
    });
  }

  const text: string[] = [];

  for await (const frame of translateToSourceEvents(stream())) {
    if (frame.type !== "event") continue;
    if (frame.event.type !== "content_block_delta") continue;
    if (frame.event.delta.type !== "text_delta") continue;

    text.push(frame.event.delta.text);
  }

  assertEquals(text.join(""), "No.");
});
