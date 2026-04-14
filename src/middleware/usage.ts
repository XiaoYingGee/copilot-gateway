// Usage tracking middleware — intercepts responses to extract token usage
// without modifying route handlers

import type { Context, Next } from "hono";
import { recordUsage } from "../lib/usage-tracker.ts";
import { touchApiKeyLastUsed } from "../lib/api-keys.ts";

const PROXY_SUFFIXES = [
  "/messages",
  "/chat/completions",
  "/responses",
  "/embeddings",
];

function isProxyPath(path: string): boolean {
  return PROXY_SUFFIXES.some((s) => path === s || path === `/v1${s}`);
}

export const usageMiddleware = async (c: Context, next: Next) => {
  if (!isProxyPath(c.req.path) || c.req.method !== "POST") {
    return next();
  }

  await next();

  // Read model set by route handlers (avoids redundant JSON.parse of request body)
  const model: string = c.get("model") ?? "unknown";

  const keyId: string | undefined = c.get("apiKeyId");
  if (!keyId) return;

  const contentType = c.res.headers.get("content-type") ?? "";
  const status = c.res.status;
  if (status < 200 || status >= 300) return; // skip error responses

  try {
    if (contentType.includes("text/event-stream")) {
      interceptStreaming(c, keyId, model);
    } else {
      await interceptNonStreaming(c, keyId, model);
    }
  } catch (e) {
    console.error("Usage tracking error:", e);
  }
};

async function interceptNonStreaming(
  c: Context,
  keyId: string,
  model: string,
): Promise<void> {
  const original = c.res;
  const cloned = original.clone();
  // deno-lint-ignore no-explicit-any
  let json: any;
  try {
    json = await cloned.json();
  } catch {
    return;
  }

  const usage = extractUsageFromJson(json);
  if (usage) {
    const p1 = recordUsage(
      keyId,
      model,
      usage.input,
      usage.output,
      usage.cacheRead,
      usage.cacheCreation,
    ).catch((e) => console.error("Usage record error:", e));
    const p2 = touchApiKeyLastUsed(keyId).catch((e) =>
      console.error("Touch lastUsedAt error:", e)
    );
    safeWaitUntil(c, p1);
    safeWaitUntil(c, p2);
  }
}

function interceptStreaming(c: Context, keyId: string, model: string): void {
  const original = c.res;
  const body = original.body;
  if (!body) return;

  const usage: UsageInfo = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
  };
  let gotInputFromStart = false;
  let buffer = "";
  const decoder = new TextDecoder();

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);

      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        gotInputFromStart = consumeUsageLine(line, usage, gotInputFromStart);
      }
    },
    flush() {
      buffer += decoder.decode();
      if (buffer) {
        gotInputFromStart = consumeUsageLine(buffer, usage, gotInputFromStart);
      }

      if (usage.input > 0 || usage.output > 0) {
        const p1 = recordUsage(
          keyId,
          model,
          usage.input,
          usage.output,
          usage.cacheRead,
          usage.cacheCreation,
        ).catch((e) => console.error("Usage record error:", e));
        const p2 = touchApiKeyLastUsed(keyId).catch((e) =>
          console.error("Touch lastUsedAt error:", e)
        );
        safeWaitUntil(c, p1);
        safeWaitUntil(c, p2);
      }
    },
  });

  const newBody = body.pipeThrough(transform);
  c.res = new Response(newBody, {
    status: original.status,
    headers: original.headers,
  });
}

/** Safely call waitUntil if available (CF Workers). Deno Deploy throws on c.executionCtx access. */
function safeWaitUntil(c: Context, promise: Promise<unknown>): void {
  try {
    c.executionCtx?.waitUntil?.(promise);
  } catch {
    // Deno Deploy: no ExecutionContext — promises settle on their own
  }
}

interface UsageInfo {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

interface StreamUsageInfo extends UsageInfo {
  fromStart: boolean;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object"
    ? value as JsonObject
    : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function addUsage(total: UsageInfo, next: UsageInfo): void {
  total.input += next.input;
  total.output += next.output;
  total.cacheRead += next.cacheRead;
  total.cacheCreation += next.cacheCreation;
}

function consumeUsageLine(
  line: string,
  usage: UsageInfo,
  gotInputFromStart: boolean,
): boolean {
  if (!line.startsWith("data: ")) return gotInputFromStart;

  const data = line.slice(6).trim();
  if (!data || data === "[DONE]") return gotInputFromStart;

  try {
    const parsed = JSON.parse(data);
    const extracted = extractUsageFromStreamEvent(parsed, gotInputFromStart);
    if (!extracted) return gotInputFromStart;

    addUsage(usage, extracted);
    return gotInputFromStart || extracted.fromStart;
  } catch {
    return gotInputFromStart;
  }
}

// deno-lint-ignore no-explicit-any
function extractUsageFromJson(json: any): UsageInfo | null {
  if (json?.usage?.input_tokens != null) {
    const cacheRead = json.usage.cache_read_input_tokens ?? 0;
    const cacheCreation = json.usage.cache_creation_input_tokens ?? 0;
    return {
      input: json.usage.input_tokens + cacheRead + cacheCreation,
      output: json.usage.output_tokens ?? 0,
      cacheRead,
      cacheCreation,
    };
  }

  if (json?.usage?.prompt_tokens != null) {
    return {
      input: json.usage.prompt_tokens,
      output: json.usage.completion_tokens ?? 0,
      cacheRead: json.usage.prompt_tokens_details?.cached_tokens ?? 0,
      cacheCreation: 0,
    };
  }

  return null;
}

function extractUsageFromStreamEvent(
  parsed: unknown,
  gotInputFromStart: boolean,
): StreamUsageInfo | null {
  const payload = asObject(parsed);
  if (!payload) return null;

  if (payload.type === "message_start") {
    const message = asObject(payload.message);
    const usage = asObject(message?.usage);
    if (!usage) return null;

    const cacheRead = readNumber(usage.cache_read_input_tokens) ?? 0;
    const cacheCreation = readNumber(usage.cache_creation_input_tokens) ?? 0;
    const input = (readNumber(usage.input_tokens) ?? 0) + cacheRead +
      cacheCreation;
    return input > 0
      ? { input, output: 0, cacheRead, cacheCreation, fromStart: true }
      : null;
  }

  // In translated streams (OpenAI→Anthropic), the message_start may have
  // input_tokens=0 because the upstream usage-only chunk arrives after the
  // first chunk. The usage-only chunk generates a supplemental message_delta
  // carrying both input_tokens and output_tokens. We only extract input_tokens
  // from message_delta when message_start didn't already provide them.
  if (payload.type === "message_delta") {
    const usage = asObject(payload.usage);
    if (!usage) return null;
    const output = readNumber(usage.output_tokens);
    if (output == null) return null;

    let input = 0;
    let cacheRead = 0;
    let cacheCreation = 0;
    if (!gotInputFromStart && readNumber(usage.input_tokens) != null) {
      cacheRead = readNumber(usage.cache_read_input_tokens) ?? 0;
      cacheCreation = readNumber(usage.cache_creation_input_tokens) ?? 0;
      input = (readNumber(usage.input_tokens) ?? 0) + cacheRead + cacheCreation;
    }
    return { input, output, cacheRead, cacheCreation, fromStart: false };
  }

  if (payload.type === "response.completed") {
    const response = asObject(payload.response);
    const usage = asObject(response?.usage);
    if (!usage) return null;
    const details = asObject(usage.input_tokens_details);
    return {
      input: readNumber(usage.input_tokens) ?? 0,
      output: readNumber(usage.output_tokens) ?? 0,
      cacheRead: readNumber(details?.cached_tokens) ?? 0,
      cacheCreation: 0,
      fromStart: false,
    };
  }

  const usage = asObject(payload.usage);
  if (readNumber(usage?.prompt_tokens) != null) {
    const details = asObject(usage?.prompt_tokens_details);
    return {
      input: readNumber(usage?.prompt_tokens) ?? 0,
      output: readNumber(usage?.completion_tokens) ?? 0,
      cacheRead: readNumber(details?.cached_tokens) ?? 0,
      cacheCreation: 0,
      fromStart: false,
    };
  }

  return null;
}
