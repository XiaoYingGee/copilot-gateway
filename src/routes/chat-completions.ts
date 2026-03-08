// POST /v1/chat/completions — passthrough to Copilot

import type { Context } from "hono";
import { copilotFetch } from "../lib/copilot.ts";
import { getEnv } from "../middleware/auth.ts";

export const chatCompletions = async (c: Context) => {
  try {
    const body = await c.req.text();
    const resp = await copilotFetch(
      "/chat/completions",
      { method: "POST", body },
      getEnv("GITHUB_TOKEN"),
      getEnv("ACCOUNT_TYPE"),
    );

    const contentType = resp.headers.get("content-type") ?? "application/json";

    if (contentType.includes("text/event-stream")) {
      return new Response(resp.body, {
        status: resp.status,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
        },
      });
    }

    return new Response(resp.body, {
      status: resp.status,
      headers: { "content-type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 502);
  }
};
