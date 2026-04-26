import { assertEquals, assertRejects } from "@std/assert";
import { doneFrame, eventFrame, type ProtocolFrame } from "./types.ts";
import {
  protocolEventsUntilTerminal,
  protocolFramesUntilTerminal,
  type ProtocolTerminalAlgebra,
} from "./protocol-algebra.ts";

interface TestEvent {
  type: "delta" | "stop" | "error";
  text?: string;
}

const eventTerminalAlgebra = {
  isTerminalEvent: (event: TestEvent) =>
    event.type === "stop" || event.type === "error",
  missingTerminalMessage: "missing terminal event",
} satisfies ProtocolTerminalAlgebra<TestEvent>;

const doneTerminalAlgebra = {
  doneTerminates: true,
  missingTerminalMessage: "missing done sentinel",
} satisfies ProtocolTerminalAlgebra<TestEvent>;

// @ts-expect-error ProtocolTerminalAlgebra requires a terminal rule.
const invalidTerminalAlgebra: ProtocolTerminalAlgebra<TestEvent> = {
  missingTerminalMessage: "missing terminal event",
};

const collect = async <T>(events: AsyncIterable<T>): Promise<T[]> => {
  const collected: T[] = [];
  for await (const event of events) collected.push(event);
  return collected;
};

const stream = async function* <TEvent>(
  frames: ProtocolFrame<TEvent>[],
): AsyncGenerator<ProtocolFrame<TEvent>> {
  yield* frames;
};

Deno.test("protocolFramesUntilTerminal passes frames through terminal events", async () => {
  const frames = [
    eventFrame<TestEvent>({ type: "delta", text: "partial" }),
    eventFrame<TestEvent>({ type: "stop" }),
  ];

  assertEquals(
    await collect(
      protocolFramesUntilTerminal(stream(frames), eventTerminalAlgebra),
    ),
    frames,
  );
});

Deno.test("protocolFramesUntilTerminal stops after the terminal frame", async () => {
  const frames = await collect(protocolFramesUntilTerminal(
    stream([
      eventFrame<TestEvent>({ type: "delta", text: "partial" }),
      eventFrame<TestEvent>({ type: "stop" }),
      eventFrame<TestEvent>({ type: "delta", text: "ignored" }),
    ]),
    eventTerminalAlgebra,
  ));

  assertEquals(frames, [
    eventFrame<TestEvent>({ type: "delta", text: "partial" }),
    eventFrame<TestEvent>({ type: "stop" }),
  ]);
});

Deno.test("protocolFramesUntilTerminal drops non-terminal DONE frames", async () => {
  const frames = await collect(protocolFramesUntilTerminal(
    stream([
      eventFrame<TestEvent>({ type: "delta", text: "partial" }),
      doneFrame(),
      eventFrame<TestEvent>({ type: "stop" }),
    ]),
    eventTerminalAlgebra,
  ));

  assertEquals(frames, [
    eventFrame<TestEvent>({ type: "delta", text: "partial" }),
    eventFrame<TestEvent>({ type: "stop" }),
  ]);
});

Deno.test("protocolFramesUntilTerminal rejects streams without a configured terminal", async () => {
  await assertRejects(
    async () => {
      await collect(protocolFramesUntilTerminal(
        stream([
          eventFrame<TestEvent>({ type: "delta", text: "partial" }),
          doneFrame(),
        ]),
        eventTerminalAlgebra,
      ));
    },
    Error,
    "missing terminal event",
  );
});

Deno.test("protocolFramesUntilTerminal can treat protocol done as the terminal", async () => {
  const frames = [
    eventFrame<TestEvent>({ type: "delta", text: "partial" }),
    doneFrame(),
  ];

  assertEquals(
    await collect(
      protocolFramesUntilTerminal(stream(frames), doneTerminalAlgebra),
    ),
    frames,
  );
});

Deno.test("protocolEventsUntilTerminal includes terminal events by default", async () => {
  const events = await collect(protocolEventsUntilTerminal(
    stream([
      eventFrame<TestEvent>({ type: "delta", text: "partial" }),
      eventFrame<TestEvent>({ type: "stop" }),
      eventFrame<TestEvent>({ type: "delta", text: "ignored" }),
    ]),
    eventTerminalAlgebra,
  ));

  assertEquals(events, [
    { type: "delta", text: "partial" },
    { type: "stop" },
  ]);
});

Deno.test("protocolEventsUntilTerminal stops at done without yielding it", async () => {
  const events = await collect(protocolEventsUntilTerminal(
    stream([
      eventFrame<TestEvent>({ type: "delta", text: "partial" }),
      doneFrame(),
      eventFrame<TestEvent>({ type: "delta", text: "ignored" }),
    ]),
    doneTerminalAlgebra,
  ));

  assertEquals(events, [{ type: "delta", text: "partial" }]);
});

Deno.test("protocolEventsUntilTerminal rejects streams missing the terminal", async () => {
  await assertRejects(
    async () => {
      await collect(protocolEventsUntilTerminal(
        stream([
          eventFrame<TestEvent>({ type: "delta", text: "partial" }),
        ]),
        doneTerminalAlgebra,
      ));
    },
    Error,
    "missing done sentinel",
  );
});
