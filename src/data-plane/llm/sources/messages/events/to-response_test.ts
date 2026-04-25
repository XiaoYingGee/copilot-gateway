import { assertEquals, assertRejects } from "@std/assert";
import type {
  MessagesResponse,
  MessagesStreamEventData,
} from "../../../../../lib/messages-types.ts";
import { eventFrame } from "../../../shared/stream/types.ts";
import { messagesResultToEvents } from "../../../targets/messages/events/from-result.ts";
import { collectMessagesProtocolEventsToResponse } from "./to-response.ts";

Deno.test("collectMessagesProtocolEventsToResponse reassembles synthetic Messages events", async () => {
  const expected: MessagesResponse = {
    id: "msg_1",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "Hello" }],
    model: "claude-test",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 3, output_tokens: 2 },
  };

  async function* events() {
    yield* messagesResultToEvents(expected);
  }

  assertEquals(
    await collectMessagesProtocolEventsToResponse(events()),
    expected,
  );
});

Deno.test("collectMessagesProtocolEventsToResponse preserves final message_delta input_tokens", async () => {
  async function* events() {
    const payloads: MessagesStreamEventData[] = [{
      type: "message_start",
      message: {
        id: "msg_late_usage",
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-test",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    }, {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }, {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "answer" },
    }, {
      type: "content_block_stop",
      index: 0,
    }, {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { input_tokens: 12, output_tokens: 4 },
    }, {
      type: "message_stop",
    }];

    for (const event of payloads) yield eventFrame(event);
  }

  const response = await collectMessagesProtocolEventsToResponse(events());

  assertEquals(response.usage, { input_tokens: 12, output_tokens: 4 });
});

Deno.test("collectMessagesProtocolEventsToResponse rejects streams without message_stop", async () => {
  async function* events() {
    const payloads: MessagesStreamEventData[] = [{
      type: "message_start",
      message: {
        id: "msg_truncated",
        type: "message",
        role: "assistant",
        content: [],
        model: "claude-test",
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 3, output_tokens: 0 },
      },
    }, {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }, {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "partial" },
    }, {
      type: "content_block_stop",
      index: 0,
    }, {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 1 },
    }];

    for (const event of payloads) yield eventFrame(event);
  }

  await assertRejects(
    async () => await collectMessagesProtocolEventsToResponse(events()),
    Error,
    "Messages stream ended without a message_stop event.",
  );
});
