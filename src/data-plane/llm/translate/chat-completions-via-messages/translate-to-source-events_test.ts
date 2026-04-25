import { assertRejects } from "@std/assert";
import type { MessagesStreamEventData } from "../../../../lib/messages-types.ts";
import { eventFrame, type ProtocolFrame } from "../../shared/stream/types.ts";
import { translateToSourceEvents } from "./translate-to-source-events.ts";

const drain = async <T>(frames: AsyncIterable<T>): Promise<void> => {
  for await (const _frame of frames) {
    // Exhaust the stream so async translator errors surface to the caller.
  }
};

Deno.test("translateToSourceEvents rejects Messages error events", async () => {
  async function* stream(): AsyncGenerator<
    ProtocolFrame<MessagesStreamEventData>
  > {
    yield eventFrame({
      type: "error",
      error: {
        type: "overloaded_error",
        message: "upstream overloaded",
      },
    });
  }

  await assertRejects(
    async () => await drain(translateToSourceEvents(stream())),
    Error,
    "Upstream Messages stream error: overloaded_error: upstream overloaded",
  );
});
