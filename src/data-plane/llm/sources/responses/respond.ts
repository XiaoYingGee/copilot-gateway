import type { Context } from "hono";
import {
  type InternalDebugError,
  toInternalDebugError,
} from "../../shared/errors/internal-debug-error.ts";
import {
  collectResponsesProtocolEventsToResult,
} from "./events/to-response.ts";
import {
  responsesProtocolEventsToSSEFrames,
  type SourceResponseStreamEvent,
} from "./events/to-sse.ts";
import { responsesSourceInterceptors } from "./interceptors/index.ts";
import type { StreamExecuteResult } from "../../shared/errors/result.ts";
import { upstreamErrorToResponse } from "../../shared/errors/upstream-error.ts";
import { proxySSE } from "../../shared/stream/proxy-sse.ts";
import { sseFrame } from "../../shared/stream/types.ts";
import { runSourceInterceptors } from "../run-interceptors.ts";

const internalResponsesErrorPayload = (error: InternalDebugError) => ({
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

const internalResponsesErrorResponse = (
  status: number,
  error: InternalDebugError,
): Response => Response.json(internalResponsesErrorPayload(error), { status });

const internalResponsesStreamErrorFrame = (error: unknown) => {
  const debug = toInternalDebugError(error, "responses");

  return sseFrame(
    JSON.stringify({
      type: "error",
      message: debug.message,
      code: debug.type,
      name: debug.name,
      stack: debug.stack,
      cause: debug.cause,
      source_api: debug.source_api,
      target_api: debug.target_api,
    }),
    "error",
  );
};

export const respondResponses = async (
  c: Context,
  initialResult: StreamExecuteResult<SourceResponseStreamEvent>,
  wantsStream: boolean,
): Promise<Response> => {
  const result = await runSourceInterceptors(
    initialResult,
    responsesSourceInterceptors,
  );

  if (result.type === "upstream-error") return upstreamErrorToResponse(result);
  if (result.type === "internal-error") {
    return internalResponsesErrorResponse(result.status, result.error);
  }

  return wantsStream
    ? proxySSE(c, responsesProtocolEventsToSSEFrames(result.events), {
      onError: internalResponsesStreamErrorFrame,
    })
    : Response.json(
      await collectResponsesProtocolEventsToResult(result.events),
    );
};
