import type { Context, Next } from "hono";
import {
  type BackgroundScheduler,
  backgroundSchedulerFromContext,
  scheduleBackground,
} from "../lib/background.ts";
import {
  type PerformanceTelemetryContext,
  recordPerformanceError,
  recordPerformanceLatency,
  runtimeLocationFromRequest,
} from "../lib/performance-telemetry.ts";
import {
  getPerformanceFailureCapture,
  getPerformanceResponseMetadata,
} from "./usage-response-metadata.ts";
import type { PerformanceApiName } from "../repo/types.ts";

const SOURCE_API_BY_PATH: Record<string, PerformanceApiName> = {
  "/messages": "messages",
  "/v1/messages": "messages",
  "/responses": "responses",
  "/v1/responses": "responses",
  "/chat/completions": "chat-completions",
  "/v1/chat/completions": "chat-completions",
};

export const performanceMiddleware = async (c: Context, next: Next) => {
  const sourceApi = SOURCE_API_BY_PATH[c.req.path];
  if (!sourceApi || c.req.method !== "POST") return await next();

  const startedAt = performance.now();
  try {
    await next();
  } catch (error) {
    recordFailedRequestTotal(c, sourceApi, performance.now() - startedAt);
    throw error;
  }

  const keyId: string | undefined = c.get("apiKeyId");
  if (!keyId) return;
  const scheduler = backgroundSchedulerFromContext(c);

  const metadata = getPerformanceResponseMetadata(c);
  const failureCapture = getPerformanceFailureCapture(c);
  const context = metadata ?? fallbackContext(c, keyId, sourceApi);
  const state: RequestPerformanceState = {
    failed: c.res.status < 200 || c.res.status >= 300 ||
      failureCapture?.failed === true,
  };
  if (state.failed || !metadata) {
    recordRequestTotal(
      scheduler,
      context,
      state,
      performance.now() - startedAt,
    );
    return;
  }

  const body = c.res.body;
  if (
    body &&
    (c.res.headers.get("content-type") ?? "").includes("text/event-stream")
  ) {
    c.res = wrapStreamingResponse(
      c.res,
      (completion) => {
        if (completion === "error") state.failed = true;
        if (completion === "cancel" && !failureCapture?.completed) {
          state.failed = true;
        }
        if (failureCapture?.failed) state.failed = true;
        recordRequestTotal(
          scheduler,
          context,
          state,
          performance.now() - startedAt,
        );
      },
    );
    return;
  }

  recordRequestTotal(scheduler, context, state, performance.now() - startedAt);
};

interface RequestPerformanceState {
  failed: boolean;
}

function recordRequestTotal(
  scheduler: BackgroundScheduler | undefined,
  context: PerformanceTelemetryContext,
  state: RequestPerformanceState,
  durationMs: number,
): void {
  scheduleBackground(
    scheduler,
    state.failed
      ? recordPerformanceError(context, "request_total")
      : recordPerformanceLatency(context, "request_total", durationMs),
  );
}

function recordFailedRequestTotal(
  c: Context,
  sourceApi: PerformanceApiName,
  durationMs: number,
): void {
  const keyId: string | undefined = c.get("apiKeyId");
  if (!keyId) return;

  recordRequestTotal(
    backgroundSchedulerFromContext(c),
    getPerformanceResponseMetadata(c) ?? fallbackContext(c, keyId, sourceApi),
    { failed: true },
    durationMs,
  );
}

function fallbackContext(
  c: Context,
  keyId: string,
  sourceApi: PerformanceApiName,
): PerformanceTelemetryContext {
  return {
    keyId,
    model: "unknown",
    sourceApi,
    targetApi: sourceApi,
    stream: false,
    runtimeLocation: runtimeLocationFromRequest(c.req.raw),
  };
}

function wrapStreamingResponse(
  response: Response,
  onComplete: (completion: StreamCompletion) => void,
): Response {
  const body = response.body;
  if (!body) return response;

  const reader = body.getReader();
  let recorded = false;
  const recordOnce = (completion: StreamCompletion): void => {
    if (recorded) return;
    recorded = true;
    onComplete(completion);
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          recordOnce("eof");
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        recordOnce("error");
        controller.error(error);
      }
    },
    async cancel(reason) {
      recordOnce("cancel");
      await reader.cancel(reason);
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

type StreamCompletion = "eof" | "error" | "cancel";
