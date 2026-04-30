import type { Context } from "hono";
import type {
  MessagesPayload,
  MessagesStreamEventData,
} from "../../../../lib/messages-types.ts";
import { normalizeMessagesRequest } from "./normalize/request.ts";
import { planMessagesRequest } from "./plan.ts";
import { getModelCapabilities } from "../../shared/models/get-model-capabilities.ts";
import {
  messagesModelResolutionIntent,
  resolveModelForRequest,
} from "../../shared/models/resolve-model.ts";
import { buildTargetRequest as buildChatTargetRequest } from "../../translate/messages-via-chat-completions/build-target-request.ts";
import { buildTargetRequest as buildResponsesTargetRequest } from "../../translate/messages-via-responses/build-target-request.ts";
import { emitToMessages } from "../../targets/messages/emit.ts";
import { emitToResponses } from "../../targets/responses/emit.ts";
import { emitToChatCompletions } from "../../targets/chat-completions/emit.ts";
import { translateToSourceEvents as translateResponsesToSourceEvents } from "../../translate/messages-via-responses/translate-to-source-events.ts";
import { translateToSourceEvents as translateChatToSourceEvents } from "../../translate/messages-via-chat-completions/translate-to-source-events.ts";
import { respondMessages } from "./respond.ts";
import {
  internalErrorResult,
  type StreamExecuteResult,
} from "../../shared/errors/result.ts";
import { toInternalDebugError } from "../../shared/errors/internal-debug-error.ts";
import type { ProtocolFrame } from "../../shared/stream/types.ts";
import { withAccountFallback } from "../../../shared/account-pool/fallback.ts";

const withTranslatedEvents = <T>(
  result: StreamExecuteResult<T>,
  translate: (
    events: AsyncIterable<ProtocolFrame<T>>,
  ) => AsyncIterable<ProtocolFrame<MessagesStreamEventData>>,
): StreamExecuteResult<MessagesStreamEventData> =>
  result.type === "events"
    ? { ...result, events: translate(result.events) }
    : result;

const withUsageModel = <T>(
  result: StreamExecuteResult<T>,
  usageModel: string,
): StreamExecuteResult<T> =>
  result.type === "events" ? { ...result, usageModel } : result;

export const serveMessages = async (
  c: Context,
): Promise<Response> => {
  try {
    const payload = await c.req.json<MessagesPayload>();
    normalizeMessagesRequest(payload);
    const apiKeyId = c.get("apiKeyId") as string | undefined;
    const wantsStream = payload.stream === true;
    const rawBeta = c.req.header("anthropic-beta");
    const intent = messagesModelResolutionIntent(payload, rawBeta);
    const modelId = await resolveModelForRequest(payload.model, intent);

    const result = await withAccountFallback(
      modelId,
      async ({ account }) => {
        const attemptPayload = structuredClone(payload);
        attemptPayload.model = modelId;
        const capabilities = await getModelCapabilities(
          modelId,
          account.token,
          account.accountType,
        );
        const plan = planMessagesRequest(attemptPayload, capabilities, rawBeta);

        if (plan.target === "messages") {
          return withUsageModel(
            await emitToMessages({
              sourceApi: "messages",
              payload: attemptPayload,
              githubToken: account.token,
              accountType: account.accountType,
              apiKeyId,
              fetchOptions: plan.fetchOptions,
              rawBeta: plan.rawBeta,
            }),
            attemptPayload.model,
          );
        }

        if (plan.target === "responses") {
          const targetPayload = buildResponsesTargetRequest(attemptPayload);
          const result = await emitToResponses({
            sourceApi: "messages",
            payload: targetPayload,
            githubToken: account.token,
            accountType: account.accountType,
            apiKeyId,
            fetchOptions: plan.fetchOptions,
          });

          return withUsageModel(
            withTranslatedEvents(result, translateResponsesToSourceEvents),
            targetPayload.model,
          );
        }

        const targetPayload = buildChatTargetRequest(attemptPayload);
        const result = await emitToChatCompletions({
          sourceApi: "messages",
          payload: targetPayload,
          githubToken: account.token,
          accountType: account.accountType,
          apiKeyId,
          fetchOptions: plan.fetchOptions,
        });

        return withUsageModel(
          withTranslatedEvents(result, translateChatToSourceEvents),
          targetPayload.model,
        );
      },
    );

    return await respondMessages(
      c,
      result,
      wantsStream,
    );
  } catch (error) {
    return await respondMessages(
      c,
      internalErrorResult(502, toInternalDebugError(error, "messages")),
      false,
    );
  }
};
