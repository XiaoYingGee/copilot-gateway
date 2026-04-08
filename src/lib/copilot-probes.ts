import { copilotFetch } from "./copilot.ts";
import { getOrProbe } from "./probe.ts";
import {
  getAnthropicRequestedReasoningEffort,
  isResponsesReasoningEffort,
  mapThinkingBudgetToReasoningEffort,
  pickSupportedReasoningEffort,
  RESPONSES_REASONING_EFFORTS,
  type ResponsesReasoningEffort,
} from "./reasoning.ts";
import type { AnthropicMessagesPayload } from "./anthropic-types.ts";
import type { ChatCompletionsPayload } from "./openai-types.ts";

const PROBE_TTL_MS = 24 * 60 * 60 * 1000;
const PROBE_MAX_OUTPUT_TOKENS = 1;

function isResponsesReasoningEffortList(
  value: unknown,
): value is ResponsesReasoningEffort[] {
  return Array.isArray(value) && value.every(isResponsesReasoningEffort);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

async function discardResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Ignore — probe requests only care about status/capabilities.
  }
}

async function assertResponsesBaseline(
  model: string,
  githubToken: string,
  accountType: string,
): Promise<void> {
  const response = await copilotFetch(
    "/responses",
    {
      method: "POST",
      body: JSON.stringify({
        model,
        input: [{ type: "message", role: "user", content: "ping" }],
        max_output_tokens: PROBE_MAX_OUTPUT_TOKENS,
        store: false,
        stream: false,
      }),
    },
    githubToken,
    accountType,
    { initiator: "user" },
  );

  if (response.ok) {
    await discardResponse(response);
    return;
  }

  const text = await response.text();
  throw new Error(
    `Responses capability probe baseline failed for ${model}: ${response.status} ${text}`,
  );
}

async function assertChatCompletionsBaseline(
  model: string,
  githubToken: string,
  accountType: string,
): Promise<void> {
  const response = await copilotFetch(
    "/chat/completions",
    {
      method: "POST",
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: PROBE_MAX_OUTPUT_TOKENS,
        stream: false,
      }),
    },
    githubToken,
    accountType,
    { initiator: "user" },
  );

  if (response.ok) {
    await discardResponse(response);
    return;
  }

  const text = await response.text();
  throw new Error(
    `Chat Completions capability probe baseline failed for ${model}: ${response.status} ${text}`,
  );
}

export async function probeResponsesReasoningEfforts(
  model: string,
  githubToken: string,
  accountType: string,
): Promise<ResponsesReasoningEffort[]> {
  return await getOrProbe({
    key: "copilot.responses.reasoning-efforts",
    version: "1",
    ttlMs: PROBE_TTL_MS,
    scope: { accountType, githubToken, model, endpoint: "/responses" },
    validate: isResponsesReasoningEffortList,
    probe: async () => {
      await assertResponsesBaseline(model, githubToken, accountType);

      const supported: ResponsesReasoningEffort[] = [];
      for (const effort of RESPONSES_REASONING_EFFORTS) {
        const response = await copilotFetch(
          "/responses",
          {
            method: "POST",
            body: JSON.stringify({
              model,
              input: [{ type: "message", role: "user", content: "ping" }],
              max_output_tokens: PROBE_MAX_OUTPUT_TOKENS,
              store: false,
              stream: false,
              reasoning: { effort, summary: "concise" },
            }),
          },
          githubToken,
          accountType,
          { initiator: "user" },
        );

        if (response.ok) {
          supported.push(effort);
          await discardResponse(response);
          continue;
        }

        if (response.status === 400) {
          await response.text();
          continue;
        }

        const text = await response.text();
        throw new Error(
          `Responses capability probe failed for ${model} effort=${effort}: ${response.status} ${text}`,
        );
      }

      return supported;
    },
  });
}

export async function selectResponsesReasoningEffortForAnthropic(
  payload: AnthropicMessagesPayload,
  githubToken: string,
  accountType: string,
): Promise<ResponsesReasoningEffort | null> {
  const requested = getAnthropicRequestedReasoningEffort(payload);
  if (!requested) return null;

  try {
    const supported = await probeResponsesReasoningEfforts(
      payload.model,
      githubToken,
      accountType,
    );
    return pickSupportedReasoningEffort(requested, supported);
  } catch (error) {
    console.warn("Failed to probe Responses reasoning efforts:", error);
    return null;
  }
}

export async function selectResponsesReasoningEffortForChat(
  payload: ChatCompletionsPayload,
  githubToken: string,
  accountType: string,
): Promise<ResponsesReasoningEffort | null> {
  const requested = mapThinkingBudgetToReasoningEffort(payload.thinking_budget);
  if (!requested) return null;

  try {
    const supported = await probeResponsesReasoningEfforts(
      payload.model,
      githubToken,
      accountType,
    );
    return pickSupportedReasoningEffort(requested, supported);
  } catch (error) {
    console.warn("Failed to probe Responses reasoning efforts:", error);
    return null;
  }
}

export async function probeChatCompletionsThinkingBudget(
  model: string,
  githubToken: string,
  accountType: string,
): Promise<boolean> {
  return await getOrProbe({
    key: "copilot.chat-completions.thinking-budget",
    version: "1",
    ttlMs: PROBE_TTL_MS,
    scope: { accountType, githubToken, model, endpoint: "/chat/completions" },
    validate: isBoolean,
    probe: async () => {
      await assertChatCompletionsBaseline(model, githubToken, accountType);

      const response = await copilotFetch(
        "/chat/completions",
        {
          method: "POST",
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: PROBE_MAX_OUTPUT_TOKENS,
            stream: false,
            thinking_budget: 1024,
          }),
        },
        githubToken,
        accountType,
        { initiator: "user" },
      );

      if (response.ok) {
        await discardResponse(response);
        return true;
      }

      if (response.status === 400) {
        await response.text();
        return false;
      }

      const text = await response.text();
      throw new Error(
        `Chat Completions capability probe failed for ${model}: ${response.status} ${text}`,
      );
    },
  });
}
