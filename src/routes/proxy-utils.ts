import type { Context } from "hono";

type ProxyErrorStatus = 400 | 401 | 403 | 404 | 429 | 500 | 502 | 503;

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function apiErrorResponse(
  c: Context,
  message: string,
  status: ProxyErrorStatus = 502,
): Response {
  return c.json({ error: { message, type: "api_error" } }, status);
}

export function anthropicApiErrorResponse(
  c: Context,
  message: string,
  status: ProxyErrorStatus = 502,
): Response {
  return c.json(
    { type: "error", error: { type: "api_error", message } },
    status,
  );
}

export function copilotApiErrorResponse(
  c: Context,
  status: ProxyErrorStatus,
  text: string,
): Response {
  return apiErrorResponse(c, `Copilot API error: ${status} ${text}`, status);
}

export function anthropicCopilotApiErrorResponse(
  c: Context,
  status: ProxyErrorStatus,
  text: string,
): Response {
  return anthropicApiErrorResponse(
    c,
    `Copilot API error: ${status} ${text}`,
    status,
  );
}

export function noUpstreamBodyApiErrorResponse(c: Context): Response {
  return apiErrorResponse(c, "No response body from upstream", 502);
}

export function noUpstreamBodyAnthropicErrorResponse(c: Context): Response {
  return anthropicApiErrorResponse(c, "No response body from upstream", 502);
}

export function proxyJsonResponse(resp: Response): Response {
  return new Response(resp.body, {
    status: resp.status,
    headers: {
      "content-type": resp.headers.get("content-type") ?? "application/json",
    },
  });
}

/**
 * Normalize model name: convert version-number dashes to dots.
 * e.g. "claude-opus-4-6" → "claude-opus-4.6"
 *      "claude-sonnet-4-6-1m" → "claude-sonnet-4.6-1m"
 *      "claude-opus-4-6-1m" → "claude-opus-4.6-1m"
 * Does NOT touch non-version dashes (e.g. "claude-sonnet" stays).
 */
export function normalizeModelName(model: string): string {
  // Match trailing version like -4-6, -4-6-1m, -4-5 etc.
  // Pattern: a digit, dash, digit(s) that form a minor version
  // We specifically target: -(major)-(minor) where major/minor are single digits
  return model.replace(
    /(\d)-(\d+)(?=(-1m)?$)/,
    "$1.$2",
  );
}
