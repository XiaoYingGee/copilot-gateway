export interface SseFrame {
  type: "sse";
  event?: string;
  data: string;
}

export interface JsonFrame<T> {
  type: "json";
  data: T;
}

export interface EventFrame<TEvent> {
  type: "event";
  event: TEvent;
}

export interface DoneFrame {
  type: "done";
}

export type StreamFrame<T> = SseFrame | JsonFrame<T>;

export type ProtocolFrame<TEvent> = EventFrame<TEvent> | DoneFrame;

export const sseFrame = (data: string, event?: string): SseFrame => ({
  type: "sse",
  event,
  data,
});

export const jsonFrame = <T>(data: T): JsonFrame<T> => ({
  type: "json",
  data,
});

export const eventFrame = <TEvent>(event: TEvent): EventFrame<TEvent> => ({
  type: "event",
  event,
});

export const doneFrame = (): DoneFrame => ({ type: "done" });

export const protocolFramesToEvents = async function* <TEvent>(
  frames: AsyncIterable<ProtocolFrame<TEvent>>,
): AsyncGenerator<TEvent> {
  for await (const frame of frames) {
    if (frame.type === "event") yield frame.event;
  }
};
