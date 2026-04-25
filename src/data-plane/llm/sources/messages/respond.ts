import type { Context } from "hono";
import {
  type InternalDebugError,
  toInternalDebugError,
} from "../../shared/errors/internal-debug-error.ts";
import type { MessagesStreamEventData } from "../../../../lib/messages-types.ts";
import {
  collectMessagesProtocolEventsToResponse,
} from "./events/to-response.ts";
import { messagesProtocolEventsToSSEFrames } from "./events/to-sse.ts";
import { messagesSourceInterceptors } from "./interceptors/index.ts";
import { runSourceInterceptors } from "../run-interceptors.ts";
import { proxySSE } from "../../shared/stream/proxy-sse.ts";
import type { StreamExecuteResult } from "../../shared/errors/result.ts";
import { upstreamErrorToResponse } from "../../shared/errors/upstream-error.ts";
import { sseFrame } from "../../shared/stream/types.ts";

const internalMessagesErrorPayload = (error: InternalDebugError) => ({
  type: "error",
  error: {
    type: error.type,
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: error.cause,
    source_api: error.source_api,
    target_api: error.target_api,
  },
});

const internalMessagesErrorResponse = (
  status: number,
  error: InternalDebugError,
): Response => Response.json(internalMessagesErrorPayload(error), { status });

const internalMessagesStreamErrorFrame = (error: unknown) =>
  sseFrame(
    JSON.stringify(
      internalMessagesErrorPayload(toInternalDebugError(error, "messages")),
    ),
    "error",
  );

export const respondMessages = async (
  c: Context,
  initialResult: StreamExecuteResult<MessagesStreamEventData>,
  wantsStream: boolean,
): Promise<Response> => {
  const result = await runSourceInterceptors(
    initialResult,
    messagesSourceInterceptors,
  );

  if (result.type === "upstream-error") {
    return upstreamErrorToResponse(result);
  }

  if (result.type === "internal-error") {
    return internalMessagesErrorResponse(result.status, result.error);
  }

  return wantsStream
    ? proxySSE(c, messagesProtocolEventsToSSEFrames(result.events), {
      onError: internalMessagesStreamErrorFrame,
    })
    : Response.json(
      await collectMessagesProtocolEventsToResponse(result.events),
    );
};
