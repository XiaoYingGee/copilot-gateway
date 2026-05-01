import type { Context, Next } from "hono";
import { getEnv } from "../lib/env.ts";
import { validateApiKey } from "../lib/api-keys.ts";

const PUBLIC_PATHS = new Set(["/", "/dashboard", "/favicon.ico"]);
const AUTH_VALIDATE_PATHS = new Set(["/auth/login"]);

// ADMIN_KEY is only allowed on dashboard/management paths
const DASHBOARD_PREFIXES = ["/api/", "/auth/"];

// Paths the dashboard Models playground may call with ADMIN_KEY + X-Models-Playground header.
const PLAYGROUND_PATHS = new Set([
  "/v1/chat/completions",
  "/v1/messages",
  "/v1/responses",
  "/v1/models",
  "/v1/embeddings",
]);

export const authMiddleware = async (c: Context, next: Next) => {
  const path = c.req.path;

  if (PUBLIC_PATHS.has(path) && c.req.method === "GET") return next();
  if (AUTH_VALIDATE_PATHS.has(path) && c.req.method === "POST") return next();

  const key = extractKey(c);
  if (!key) return c.json({ error: "Unauthorized" }, 401);

  // ADMIN_KEY — dashboard/management only
  const adminKey = getEnv("ADMIN_KEY");
  if (adminKey && key === adminKey) {
    c.set("authKey", key);
    c.set("isAdmin", true);
    if (DASHBOARD_PREFIXES.some((p) => path.startsWith(p))) return next();
    // Dashboard Models playground escape hatch
    if (c.req.header("x-models-playground") === "1" && PLAYGROUND_PATHS.has(path)) return next();
    return c.json({ error: "This key is for dashboard only. Create an API key for API access." }, 403);
  }

  // API key — full access
  const result = await validateApiKey(key);
  if (result) {
    c.set("authKey", key);
    c.set("isAdmin", false);
    c.set("apiKeyId", result.id);
    return next();
  }

  return c.json({ error: "Unauthorized" }, 401);
};

export const adminOnlyMiddleware = async (c: Context, next: Next) => {
  if (!c.get("isAdmin")) {
    return c.json({ error: "Dashboard key required" }, 403);
  }
  await next();
};

function extractKey(c: Context): string | null {
  const url = new URL(c.req.url);
  return (
    url.searchParams.get("key") ??
    c.req.header("x-api-key") ??
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ??
    null
  );
}
