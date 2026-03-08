// Auth middleware — static key check
// Supports: ?key=, x-api-key header, Authorization: Bearer header

import type { Context, Next } from "hono";

export const authMiddleware = async (c: Context, next: Next) => {
  // Skip auth for health check
  if (c.req.path === "/" && c.req.method === "GET") {
    return next();
  }

  const url = new URL(c.req.url);
  const key =
    url.searchParams.get("key") ??
    c.req.header("x-api-key") ??
    c.req.header("authorization")?.replace(/^Bearer\s+/i, "");

  const expectedKey = getEnv("ACCESS_KEY");
  if (!expectedKey || key !== expectedKey) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  return next();
};

export function getEnv(name: string): string {
  // deno-lint-ignore no-explicit-any
  return (Deno as any).env.get(name) ?? "";
}
