import type { ChatCompletionChunk } from "../../../../lib/chat-completions-types.ts";
import type {
  ResponsesResult,
  ResponseStreamEvent,
} from "../../../../lib/responses-types.ts";
import {
  createResponsesToChatCompletionsStreamState,
  translateResponsesEventToChatCompletionsChunks,
  translateResponsesToChatCompletion,
} from "../../../../lib/translate/responses-to-chat-completions.ts";
import {
  doneFrame,
  eventFrame,
  type ProtocolFrame,
} from "../../shared/stream/types.ts";
import { chatCompletionResultToEvents } from "../../targets/chat-completions/events/from-result.ts";
import type { SequencedResponseStreamEvent } from "../../targets/responses/events/from-result.ts";

const responsesErrorMessage = (event: ResponseStreamEvent): string => {
  if (event.type === "error") {
    const error = event as Extract<ResponseStreamEvent, { type: "error" }>;
    return `${error.code ? `${error.code}: ` : ""}${error.message}`;
  }

  if (event.type === "response.failed") {
    const response = (event as Extract<
      ResponseStreamEvent,
      { type: "response.failed" }
    >).response as ResponsesResult;
    return `${response.error?.type ?? "api_error"}: ${
      response.error?.message ?? "Response failed due to unknown error."
    }`;
  }

  return "Response stream failed due to unknown error.";
};

const throwOnResponsesFatalEvent = (event: ResponseStreamEvent): void => {
  if (event.type === "error") {
    throw new Error(
      `Upstream Responses stream error: ${responsesErrorMessage(event)}`,
      {
        cause: event,
      },
    );
  }

  if (event.type === "response.failed") {
    throw new Error(
      `Upstream Responses stream failed: ${responsesErrorMessage(event)}`,
      {
        cause: event,
      },
    );
  }
};

export const translateToSourceEvents = async function* (
  frames: AsyncIterable<ProtocolFrame<SequencedResponseStreamEvent>>,
): AsyncGenerator<ProtocolFrame<ChatCompletionChunk>> {
  const state = createResponsesToChatCompletionsStreamState();
  let sawStructuredOutput = false;
  let streamingCommitted = false;
  const pendingFrames: Array<ProtocolFrame<ChatCompletionChunk>> = [];
  let yieldedTerminalFrames = false;
  let yieldedDone = false;

  for await (const frame of frames) {
    if (frame.type === "done") {
      if (!yieldedDone && state.done) {
        yieldedDone = true;
        yield frame;
      }
      continue;
    }

    const event = frame.event as ResponseStreamEvent;
    throwOnResponsesFatalEvent(event);

    if (
      event.type === "response.output_item.added" ||
      event.type === "response.output_item.done" ||
      event.type === "response.reasoning_summary_text.delta" ||
      event.type === "response.output_text.delta" ||
      event.type === "response.function_call_arguments.delta"
    ) {
      sawStructuredOutput = true;
      if (!streamingCommitted) {
        streamingCommitted = true;
        for (const pending of pendingFrames) {
          if (pending.type === "done") yieldedDone = true;
          yield pending;
        }
        pendingFrames.length = 0;
      }
    }

    if (
      !streamingCommitted &&
      !sawStructuredOutput &&
      (event.type === "response.completed" ||
        event.type === "response.incomplete")
    ) {
      pendingFrames.length = 0;
      yieldedTerminalFrames = true;
      for (
        const translated of chatCompletionResultToEvents(
          translateResponsesToChatCompletion(event.response as ResponsesResult),
        )
      ) {
        if (translated.type === "done") yieldedDone = true;
        yield translated;
      }
      continue;
    }

    const translated = translateResponsesEventToChatCompletionsChunks(
      event,
      state,
    );

    for (const chunk of translated) {
      const chunkFrame = eventFrame(chunk);
      if (streamingCommitted) {
        yield chunkFrame;
      } else {
        pendingFrames.push(chunkFrame);
      }
    }
  }

  if (!yieldedTerminalFrames && !state.done) {
    throw new Error(
      "Upstream Responses stream ended without a terminal event.",
    );
  }

  if (!streamingCommitted && pendingFrames.length > 0) {
    for (const pending of pendingFrames) {
      if (pending.type === "done") yieldedDone = true;
      yield pending;
    }
  }

  if (!yieldedTerminalFrames && !yieldedDone) {
    yield doneFrame();
  }
};
