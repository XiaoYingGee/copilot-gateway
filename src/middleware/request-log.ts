/**
 * Request logging middleware — captures cache_control markers, usage,
 * and response status per request, writes to per-key hourly log files.
 */

import type { Context, Next } from "hono";
import { writeLog } from "../lib/request-logger.ts";

const PROXY_SUFFIXES = ["/messages", "/chat/completions", "/responses", "/embeddings"];

function isProxyPath(path: string): boolean {
  return PROXY_SUFFIXES.some((s) => path === s || path === `/v1${s}`);
}

export const requestLogMiddleware = async (c: Context, next: Next) => {
  if (!isProxyPath(c.req.path) || c.req.method !== "POST") {
    return next();
  }

  const startTime = Date.now();

  // Parse request body for model
  let model = "unknown";
  try {
    const cloned = c.req.raw.clone();
    const body = await cloned.json();
    if (typeof body.model === "string") model = body.model;
  } catch { /* ignore */ }

  await next();

  // Read context values set by auth middleware and route handler
  const keyId: string = c.get("apiKeyId") || "";
  const keyName: string = c.get("keyName") || "unknown";
  const ccBefore: Record<string, unknown>[] = c.get("ccBefore") || [];
  const ccAfter: Record<string, unknown>[] = c.get("ccAfter") || [];
  const systemHash: string = c.get("systemHash") || "";
  const systemLength: number = c.get("systemLength") || 0;
  const messageCount: number = c.get("messageCount") || 0;

  // Extract usage from non-streaming responses
  const status = c.res.status;
  const contentType = c.res.headers.get("content-type") ?? "";
  let usage: { input: number; output: number; cacheRead: number; cacheCreation: number } | null = null;

  if (status >= 200 && status < 300 && !contentType.includes("text/event-stream")) {
    try {
      const cloned = c.res.clone();
      const json = await cloned.json();
      if (json?.usage?.input_tokens != null) {
        usage = {
          input: json.usage.input_tokens + (json.usage.cache_read_input_tokens ?? 0) + (json.usage.cache_creation_input_tokens ?? 0),
          output: json.usage.output_tokens ?? 0,
          cacheRead: json.usage.cache_read_input_tokens ?? 0,
          cacheCreation: json.usage.cache_creation_input_tokens ?? 0,
        };
      }
    } catch { /* streaming — usage captured by usage middleware */ }
  }

  const durationMs = Date.now() - startTime;

  // Fire and forget
  writeLog({
    ts: new Date().toISOString(),
    keyId,
    keyName,
    model,
    endpoint: c.req.path,
    cacheControlBefore: ccBefore,
    cacheControlAfter: ccAfter,
    systemHash,
    systemLength,
    messageCount,
    usage,
    durationMs,
    status,
  }).catch(() => {});
};
