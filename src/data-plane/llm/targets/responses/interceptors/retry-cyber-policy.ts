import type {
  ResponsesPayload,
  ResponsesResult,
} from "../../../../../lib/responses-types.ts";
import type { EmitInput, RawEmitResult } from "../../emit-types.ts";
import type { TargetInterceptor } from "../../run-interceptors.ts";
import type { StreamFrame } from "../../../shared/stream/types.ts";

const CYBER_POLICY_ERROR_CODE = "cyber_policy";
const MAX_CYBER_POLICY_RETRIES = 10;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getErrorCode = (value: unknown): string | undefined => {
  if (!isRecord(value) || !isRecord(value.error)) return undefined;

  const code = value.error.code;
  return typeof code === "string" ? code : undefined;
};

const isCyberPolicyPayload = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (getErrorCode(value) === CYBER_POLICY_ERROR_CODE) return true;

  return getErrorCode(value.response) === CYBER_POLICY_ERROR_CODE;
};

const isCyberPolicyUpstreamError = (
  result: RawEmitResult<ResponsesResult>,
): boolean => {
  if (result.type !== "upstream-error") return false;

  try {
    return isCyberPolicyPayload(
      JSON.parse(new TextDecoder().decode(result.body)),
    );
  } catch {
    return false;
  }
};

const isCyberPolicyJsonFrame = (response: ResponsesResult): boolean =>
  response.status === "failed" &&
  response.error?.code === CYBER_POLICY_ERROR_CODE;

const isCyberPolicySseFrame = (data: string): boolean => {
  try {
    return isCyberPolicyPayload(JSON.parse(data));
  } catch {
    return false;
  }
};

const isCyberPolicyFrame = (frame: StreamFrame<ResponsesResult>): boolean => {
  if (frame.type === "json") return isCyberPolicyJsonFrame(frame.data);

  return isCyberPolicySseFrame(frame.data);
};

const emptyFrames = async function* (): AsyncGenerator<
  StreamFrame<ResponsesResult>
> {};

const replayFirstThenRest = async function* (
  first: StreamFrame<ResponsesResult>,
  iterator: AsyncIterator<StreamFrame<ResponsesResult>>,
): AsyncGenerator<StreamFrame<ResponsesResult>> {
  let done = false;

  try {
    yield first;

    while (true) {
      const next = await iterator.next();
      if (next.done) {
        done = true;
        return;
      }

      yield next.value;
    }
  } finally {
    if (!done) await iterator.return?.();
  }
};

type EventsResult = Extract<RawEmitResult<ResponsesResult>, { type: "events" }>;

const inspectEventsResult = async (
  result: EventsResult,
): Promise<
  { result: RawEmitResult<ResponsesResult>; cyberPolicy: boolean }
> => {
  const iterator = result.events[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) {
    return { result: { ...result, events: emptyFrames() }, cyberPolicy: false };
  }

  if (!isCyberPolicyFrame(first.value)) {
    return {
      result: {
        ...result,
        events: replayFirstThenRest(first.value, iterator),
      },
      cyberPolicy: false,
    };
  }

  // Retry only before any failed attempt frames reach the source pipeline.
  // Once a non-policy first frame is yielded, retrying a later failure would
  // splice multiple upstream attempts into one downstream stream.
  await iterator.return?.();
  return {
    result: { ...result, events: replayFirstThenRest(first.value, iterator) },
    cyberPolicy: true,
  };
};

const inspectAttemptResult = async (
  result: RawEmitResult<ResponsesResult>,
): Promise<
  { result: RawEmitResult<ResponsesResult>; cyberPolicy: boolean }
> => {
  if (result.type !== "events") {
    return { result, cyberPolicy: isCyberPolicyUpstreamError(result) };
  }

  return await inspectEventsResult(result);
};

/**
 * OpenAI's GPT-5.x Responses path is prone to intermittent false-positive
 * `cyber_policy` failures for Codex traffic. Copilot upstream does not support
 * the Trusted Access for Cyber program named in OpenAI's client-facing text, so
 * this gateway cannot resolve those failures through account verification and
 * can only retry the upstream attempt.
 *
 * Keep this at the `/responses` target boundary because both HTTP error bodies
 * and streaming `response.failed` payloads are upstream protocol details. The
 * interceptor suppresses retried failed attempts and passes through either the
 * first successful attempt or the final policy failure.
 *
 * References:
 * - https://openai.com/index/trusted-access-for-cyber/
 * - https://deploymentsafety.openai.com/gpt-5-3-codex/cybersecurity
 *
 * TODO: Add gateway-side recent cyber-policy retry/error-log storage so
 * operators can inspect detailed upstream failures, matching the web-search shim
 * error-log TODO pattern.
 */
export const withCyberPolicyRetried: TargetInterceptor<
  EmitInput<ResponsesPayload>,
  ResponsesResult
> = async (_ctx, run) => {
  let finalResult: RawEmitResult<ResponsesResult> | undefined;

  for (let attempt = 0; attempt <= MAX_CYBER_POLICY_RETRIES; attempt++) {
    const current = await inspectAttemptResult(await run());
    finalResult = current.result;

    if (!current.cyberPolicy) return current.result;
  }

  return finalResult!;
};
