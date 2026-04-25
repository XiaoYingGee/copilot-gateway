import { assertEquals } from "@std/assert";
import {
  doneFrame,
  eventFrame,
  jsonFrame,
  protocolFramesToEvents,
  sseFrame,
} from "./types.ts";

Deno.test("eventFrame carries structured protocol events", () => {
  assertEquals(eventFrame({ type: "message_stop" }), {
    type: "event",
    event: { type: "message_stop" },
  });
});

Deno.test("doneFrame marks protocol sentinels without raw SSE text", () => {
  assertEquals(doneFrame(), { type: "done" });
});

Deno.test("raw stream frame helpers keep upstream payload shape", () => {
  assertEquals(jsonFrame({ ok: true }), { type: "json", data: { ok: true } });
  assertEquals(sseFrame("{}", "message_stop"), {
    type: "sse",
    event: "message_stop",
    data: "{}",
  });
});

Deno.test("protocolFramesToEvents drops protocol sentinels", async () => {
  const events = [];
  for await (
    const event of protocolFramesToEvents((async function* () {
      yield eventFrame({ type: "message_stop" });
      yield doneFrame();
    })())
  ) {
    events.push(event);
  }

  assertEquals(events, [{ type: "message_stop" }]);
});
