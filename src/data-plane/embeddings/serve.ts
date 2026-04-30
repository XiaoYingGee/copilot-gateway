// POST /v1/embeddings — forward embedding requests to Copilot

import type { Context } from "hono";
import { copilotFetch, isCopilotTokenFetchError } from "../../lib/copilot.ts";
import { withAccountFallback } from "../shared/account-pool/fallback.ts";
import {
  apiErrorResponse,
  getErrorMessage,
  proxyJsonResponse,
} from "../shared/http/proxy-response.ts";
import { withUsageResponseMetadata } from "../../middleware/usage-response-metadata.ts";

export const embeddings = async (c: Context) => {
  try {
    const body = await c.req.text();
    let model: string | null = null;
    try {
      const parsed = JSON.parse(body) as { model?: unknown };
      if (typeof parsed.model === "string") model = parsed.model;
    } catch {
      // Let upstream preserve the request-shape error; fallback simply has no model signal.
    }

    const resp = await withAccountFallback(model ?? "unknown", ({ account }) =>
      copilotFetch(
        "/embeddings",
        { method: "POST", body },
        account.token,
        account.accountType,
      ));

    // GitHub Copilot's embeddings response does not include a `model` field, so
    // the usage middleware cannot recover one from the JSON body. Carry the
    // requested model through usage metadata to satisfy requireUsageModel().
    // This mirrors the usageModel writeback added in d8dd086 for chat
    // completions / messages / responses serves.
    const proxied = proxyJsonResponse(resp);
    return model ? withUsageResponseMetadata(proxied, { usageModel: model }) : proxied;
  } catch (e: unknown) {
    if (isCopilotTokenFetchError(e)) {
      return new Response(e.body, {
        status: e.status,
        headers: e.headers,
      });
    }

    return apiErrorResponse(c, getErrorMessage(e), 502);
  }
};
