import { copilotFetch } from "../../../../lib/copilot.ts";
import type {
  MessagesResponse,
  MessagesStreamEventData,
  MessagesTargetPayload,
} from "../../../../lib/messages-types.ts";
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
import { messagesStreamFramesToEvents } from "./events/from-stream.ts";
import { messagesTargetInterceptors } from "./interceptors/index.ts";

export interface EmitToMessagesInput extends EmitInput<MessagesTargetPayload> {
  rawBeta?: string;
}

const messagesRawResultToProtocolResult = (
  result: RawEmitResult<MessagesResponse>,
): EmitResult<MessagesStreamEventData> =>
  result.type === "events"
    ? eventResult(messagesStreamFramesToEvents(result.events))
    : result;

export const emitToMessages = async (
  input: EmitToMessagesInput,
): Promise<EmitResult<MessagesStreamEventData>> => {
  try {
    input.payload.stream = true;

    const result = await runTargetInterceptors<
      EmitToMessagesInput,
      MessagesResponse
    >(
      input,
      messagesTargetInterceptors,
      async () => {
        const response = await copilotFetch(
          "/v1/messages",
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
              "messages",
            ),
          );
        }

        if (isSSEResponse(response)) {
          return eventResult(parseSSEStream(response.body));
        }

        return eventResult((async function* () {
          yield jsonFrame(await response.json() as MessagesResponse);
        })());
      },
    );

    return messagesRawResultToProtocolResult(result);
  } catch (error) {
    return internalErrorResult(
      502,
      toInternalDebugError(error, input.sourceApi, "messages"),
    );
  }
};
