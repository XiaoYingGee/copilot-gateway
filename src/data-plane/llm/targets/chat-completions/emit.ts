import { copilotFetch } from "../../../../lib/copilot.ts";
import type {
  ChatCompletionChunk,
  ChatCompletionResponse,
  ChatCompletionsPayload,
} from "../../../../lib/chat-completions-types.ts";
import { readUpstreamError } from "../../shared/errors/upstream-error.ts";
import {
  eventResult,
  internalErrorResult,
} from "../../shared/errors/result.ts";
import { toInternalDebugError } from "../../shared/errors/internal-debug-error.ts";
import { parseSSEStream } from "../../shared/stream/parse-sse.ts";
import { isSSEResponse } from "../../shared/stream/is-sse-response.ts";
import { jsonFrame } from "../../shared/stream/types.ts";
import { runTargetInterceptors } from "../run-interceptors.ts";
import type { EmitInput, EmitResult, RawEmitResult } from "../emit-types.ts";
import { chatCompletionsStreamFramesToEvents } from "./events/from-stream.ts";
import { chatCompletionsTargetInterceptors } from "./interceptors/index.ts";

export interface EmitToChatCompletionsInput
  extends EmitInput<ChatCompletionsPayload> {}

const chatCompletionsRawResultToProtocolResult = (
  result: RawEmitResult<ChatCompletionResponse>,
): EmitResult<ChatCompletionChunk> =>
  result.type === "events"
    ? eventResult(chatCompletionsStreamFramesToEvents(result.events))
    : result;

export const emitToChatCompletions = async (
  input: EmitToChatCompletionsInput,
): Promise<EmitResult<ChatCompletionChunk>> => {
  try {
    const result = await runTargetInterceptors<
      EmitToChatCompletionsInput,
      ChatCompletionResponse
    >(
      input,
      chatCompletionsTargetInterceptors,
      async () => {
        const response = await copilotFetch(
          "/chat/completions",
          {
            method: "POST",
            body: JSON.stringify(input.payload),
          },
          input.githubToken,
          input.accountType,
          input.fetchOptions,
        );

        if (!response.ok) return await readUpstreamError(response);
        if (!response.body) {
          return internalErrorResult(
            502,
            toInternalDebugError(
              new Error("No response body from upstream"),
              input.sourceApi,
              "chat-completions",
            ),
          );
        }

        if (isSSEResponse(response)) {
          return eventResult(parseSSEStream(response.body));
        }

        return eventResult((async function* () {
          yield jsonFrame(await response.json() as ChatCompletionResponse);
        })());
      },
    );

    return chatCompletionsRawResultToProtocolResult(result);
  } catch (error) {
    return internalErrorResult(
      502,
      toInternalDebugError(error, input.sourceApi, "chat-completions"),
    );
  }
};
