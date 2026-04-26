import type { ProtocolFrame } from "./types.ts";

interface ProtocolTerminalAlgebraBase {
  missingTerminalMessage: string;
}

export type ProtocolTerminalAlgebra<TEvent> =
  | (ProtocolTerminalAlgebraBase & {
    doneTerminates: true;
    isTerminalEvent?: (event: TEvent) => boolean;
  })
  | (ProtocolTerminalAlgebraBase & {
    doneTerminates?: boolean;
    isTerminalEvent: (event: TEvent) => boolean;
  });

const isProtocolTerminalFrame = <TEvent>(
  frame: ProtocolFrame<TEvent>,
  algebra: ProtocolTerminalAlgebra<TEvent>,
): boolean =>
  frame.type === "done"
    ? algebra.doneTerminates === true
    : algebra.isTerminalEvent?.(frame.event) === true;

export const protocolFramesUntilTerminal = async function* <TEvent>(
  frames: AsyncIterable<ProtocolFrame<TEvent>>,
  algebra: ProtocolTerminalAlgebra<TEvent>,
): AsyncGenerator<ProtocolFrame<TEvent>> {
  for await (const frame of frames) {
    const isTerminal = isProtocolTerminalFrame(frame, algebra);
    if (frame.type === "done" && !isTerminal) continue;

    yield frame;
    if (isTerminal) return;
  }

  throw new Error(algebra.missingTerminalMessage);
};

export const protocolEventsUntilTerminal = async function* <TEvent>(
  frames: AsyncIterable<ProtocolFrame<TEvent>>,
  algebra: ProtocolTerminalAlgebra<TEvent>,
): AsyncGenerator<TEvent> {
  for await (const frame of protocolFramesUntilTerminal(frames, algebra)) {
    if (frame.type === "event") yield frame.event;
  }
};
