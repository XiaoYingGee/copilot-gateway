import { assertEquals } from "@std/assert";
import type { ResponsesResult } from "../../../../../lib/responses-types.ts";
import { responsesResultToEvents } from "../../../targets/responses/events/from-result.ts";
import { collectResponsesProtocolEventsToResult } from "./to-response.ts";

Deno.test("collectResponsesProtocolEventsToResult reassembles synthetic Responses events", async () => {
  const expected: ResponsesResult = {
    id: "resp_1",
    object: "response",
    model: "gpt-test",
    status: "completed",
    output_text: "Hello",
    output: [{
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Hello" }],
    }],
    usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
  };

  async function* events() {
    yield* responsesResultToEvents(expected);
  }

  assertEquals(
    await collectResponsesProtocolEventsToResult(events()),
    expected,
  );
});
