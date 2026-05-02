// GET /v1/models, /api/models — proxy to Copilot models endpoint

import type { Context } from "hono";
import { isCopilotTokenFetchError } from "../../lib/copilot.ts";
import {
  loadModelsForAccount,
  ModelsFetchError,
  type ModelsResponse,
} from "../../lib/models-cache.ts";
import { getRepo } from "../../repo/index.ts";
import {
  apiErrorResponse,
  getErrorMessage,
} from "../shared/http/proxy-response.ts";
import { mergeClaudeVariants } from "./merge.ts";

const errorResponse = (error: unknown): Response | null => {
  if (error instanceof ModelsFetchError) {
    return new Response(error.body, {
      status: error.status,
      headers: error.headers,
    });
  }

  if (isCopilotTokenFetchError(error)) {
    return new Response(error.body, {
      status: error.status,
      headers: error.headers,
    });
  }

  return null;
};

export const models = async (c: Context) => {
  try {
    const accounts = await getRepo().github.listAccounts();
    const byId = new Map<string, ModelsResponse["data"][number]>();
    let lastError: unknown = null;
    let sawSuccess = false;

    for (const account of accounts) {
      const result = await loadModelsForAccount(account);
      if (result.type === "error") {
        lastError = result.error;
        continue;
      }

      sawSuccess = true;
      for (const model of result.data.data) {
        if (!byId.has(model.id)) byId.set(model.id, model);
      }
    }

    if (sawSuccess) {
      const merged = mergeClaudeVariants({
        object: "list",
        data: [...byId.values()],
      });
      return Response.json(merged);
    }

    const upstreamErrorResponse = errorResponse(lastError);
    if (upstreamErrorResponse) return upstreamErrorResponse;
    if (lastError) return apiErrorResponse(c, getErrorMessage(lastError), 502);
    return apiErrorResponse(
      c,
      "No GitHub account connected — add one via the dashboard",
      502,
    );
  } catch (e: unknown) {
    return apiErrorResponse(c, getErrorMessage(e), 502);
  }
};
