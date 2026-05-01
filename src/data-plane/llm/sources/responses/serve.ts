import type { Context } from "hono";
import type { ResponsesPayload } from "../../../../lib/responses-types.ts";
import { normalizeResponsesRequest } from "./normalize/request.ts";
import { planResponsesRequest } from "./plan.ts";
import { getModelCapabilities } from "../../shared/models/get-model-capabilities.ts";
import {
  resolveModelForRequest,
  responsesModelResolutionIntent,
} from "../../shared/models/resolve-model.ts";
import { buildTargetRequest as buildMessagesTargetRequest } from "../../translate/responses-via-messages/build-target-request.ts";
import { buildTargetRequest as buildChatCompletionsTargetRequest } from "../../translate/responses-via-chat-completions/build-target-request.ts";
import { emitToResponses } from "../../targets/responses/emit.ts";
import { emitToMessages } from "../../targets/messages/emit.ts";
import { emitToChatCompletions } from "../../targets/chat-completions/emit.ts";
import { translateToSourceEvents } from "../../translate/responses-via-messages/translate-to-source-events.ts";
import { translateToSourceEvents as translateChatCompletionsToSourceEvents } from "../../translate/responses-via-chat-completions/translate-to-source-events.ts";
import { respondResponses } from "./respond.ts";
import {
  internalErrorResult,
  type StreamExecuteResult,
} from "../../shared/errors/result.ts";
import { toInternalDebugError } from "../../shared/errors/internal-debug-error.ts";
import type { ProtocolFrame } from "../../shared/stream/types.ts";
import type { SourceResponseStreamEvent } from "./events/protocol.ts";
import { withAccountFallback } from "../../../shared/account-pool/fallback.ts";
import {
  type PerformanceTelemetryContext,
  runtimeLocationFromRequest,
} from "../../../../lib/performance-telemetry.ts";
import { backgroundSchedulerFromContext } from "../../../../lib/background.ts";
import { withUsageResponseMetadata } from "../../../../middleware/usage-response-metadata.ts";

const withTranslatedEvents = <T>(
  result: StreamExecuteResult<T>,
  translate: (
    events: AsyncIterable<ProtocolFrame<T>>,
  ) => AsyncIterable<ProtocolFrame<SourceResponseStreamEvent>>,
): StreamExecuteResult<SourceResponseStreamEvent> =>
  result.type === "events"
    ? { ...result, events: translate(result.events) }
    : result;

const withResultMetadata = <T>(
  result: StreamExecuteResult<T>,
  usageModel: string,
  performance: PerformanceTelemetryContext,
): StreamExecuteResult<T> =>
  result.type === "events"
    ? { ...result, usageModel, performance }
    : { ...result, performance };

const unsupportedResponsesModelResponse = (model: string): Response =>
  Response.json({
    error: {
      message: `Model ${model} does not support the /responses endpoint.`,
      type: "invalid_request_error",
    },
  }, { status: 400 });

type UnsupportedStatefulContinuationField =
  | "previous_response_id"
  | "item_reference";

const isItemReferenceInput = (item: unknown): boolean =>
  typeof item === "object" && item !== null &&
  (item as { type?: unknown }).type === "item_reference";

const unsupportedStatefulContinuationField = (
  payload: ResponsesPayload,
): UnsupportedStatefulContinuationField | undefined => {
  if (
    payload.previous_response_id !== undefined &&
    payload.previous_response_id !== null
  ) {
    return "previous_response_id";
  }
  if (
    Array.isArray(payload.input) && payload.input.some(isItemReferenceInput)
  ) {
    return "item_reference";
  }
  return undefined;
};

const unsupportedStatefulContinuationResponse = (
  field: UnsupportedStatefulContinuationField,
): Response =>
  Response.json({
    error: {
      message:
        `Responses API ${field} is not supported by this gateway. Send the full input instead of using server-side conversation state references.`,
      type: "invalid_request_error",
      param: field,
    },
  }, { status: 400 });

const createTranslatedResponseId = (): string =>
  `resp_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;

export const serveResponses = async (
  c: Context,
): Promise<Response> => {
  let lastPerformance: PerformanceTelemetryContext | undefined;
  try {
    const payload = await c.req.json<ResponsesPayload>();
    // previous_response_id and item_reference require stateful server-side
    // continuation. We cannot reliably preserve that semantic across Copilot
    // account fallback and translated targets, so reject it at the Responses
    // source boundary and make clients resend the full input instead.
    const unsupportedField = unsupportedStatefulContinuationField(payload);
    if (unsupportedField) {
      return unsupportedStatefulContinuationResponse(unsupportedField);
    }
    normalizeResponsesRequest(payload);
    const apiKeyId = c.get("apiKeyId") as string | undefined;
    const wantsStream = payload.stream === true;
    const runtimeLocation = runtimeLocationFromRequest(c.req.raw);
    const scheduleBackground = backgroundSchedulerFromContext(c);
    const intent = responsesModelResolutionIntent(payload);
    const modelId = await resolveModelForRequest(payload.model, intent);
    const performanceFor = (
      model: string,
      targetApi: PerformanceTelemetryContext["targetApi"],
    ): PerformanceTelemetryContext => {
      lastPerformance = {
        keyId: apiKeyId ?? "unknown",
        model,
        sourceApi: "responses",
        targetApi,
        stream: wantsStream,
        runtimeLocation,
      };
      return lastPerformance;
    };
    performanceFor(modelId, "responses");

    const result = await withAccountFallback<
      StreamExecuteResult<SourceResponseStreamEvent> | Response
    >(modelId, async ({ account }) => {
      const attemptPayload = structuredClone(payload);
      attemptPayload.model = modelId;
      const capabilities = await getModelCapabilities(
        modelId,
        account.token,
        account.accountType,
      );
      const plan = planResponsesRequest(attemptPayload, capabilities);
      if (!plan) {
        const performance = performanceFor(attemptPayload.model, "responses");
        return withUsageResponseMetadata(
          c,
          unsupportedResponsesModelResponse(attemptPayload.model),
          { performance },
        );
      }

      if (plan.target === "responses") {
        const performance = performanceFor(attemptPayload.model, "responses");
        return withResultMetadata(
          await emitToResponses({
            sourceApi: "responses",
            payload: attemptPayload,
            githubToken: account.token,
            accountType: account.accountType,
            apiKeyId,
            clientStream: wantsStream,
            runtimeLocation,
            scheduleBackground,
            fetchOptions: plan.fetchOptions,
          }),
          attemptPayload.model,
          performance,
        );
      }

      if (plan.target === "messages") {
        performanceFor(attemptPayload.model, "messages");
        const messagesPayload = await buildMessagesTargetRequest(
          attemptPayload,
        );
        const performance = performanceFor(messagesPayload.model, "messages");
        const result = await emitToMessages({
          sourceApi: "responses",
          payload: messagesPayload,
          githubToken: account.token,
          accountType: account.accountType,
          apiKeyId,
          clientStream: wantsStream,
          runtimeLocation,
          scheduleBackground,
          fetchOptions: plan.fetchOptions,
        });

        return withResultMetadata(
          withTranslatedEvents(
            result,
            (events) =>
              translateToSourceEvents(
                events,
                createTranslatedResponseId(),
                messagesPayload.model,
              ),
          ),
          messagesPayload.model,
          performance,
        );
      }

      performanceFor(attemptPayload.model, "chat-completions");
      const chatPayload = buildChatCompletionsTargetRequest(attemptPayload);
      const performance = performanceFor(
        chatPayload.model,
        "chat-completions",
      );
      const result = await emitToChatCompletions({
        sourceApi: "responses",
        payload: chatPayload,
        githubToken: account.token,
        accountType: account.accountType,
        apiKeyId,
        clientStream: wantsStream,
        runtimeLocation,
        scheduleBackground,
        fetchOptions: plan.fetchOptions,
      });

      return withResultMetadata(
        withTranslatedEvents(
          result,
          translateChatCompletionsToSourceEvents,
        ),
        chatPayload.model,
        performance,
      );
    });

    if (result instanceof Response) return result;

    return await respondResponses(
      c,
      result,
      wantsStream,
    );
  } catch (error) {
    return await respondResponses(
      c,
      internalErrorResult(
        502,
        toInternalDebugError(error, "responses"),
        lastPerformance,
      ),
      false,
    );
  }
};
