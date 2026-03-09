// API key management routes (admin-only)

import type { Context } from "hono";
import { createApiKey, listApiKeys, deleteApiKey, rotateApiKey } from "../lib/api-keys.ts";

function requireAdmin(c: Context): Response | null {
  if (c.get("apiKeyId") !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }
  return null;
}

export const listKeys = (c: Context) => {
  const callerId = c.get("apiKeyId");

  if (callerId === "admin") {
    return listApiKeys().then((keys) =>
      c.json(keys.map((k) => ({
        id: k.id,
        name: k.name,
        key_hint: k.key.slice(-4),
        created_at: k.createdAt,
      })))
    );
  }

  // Non-admin: return only the caller's own key
  return listApiKeys().then((keys) => {
    const own = keys.filter((k) => k.id === callerId);
    return c.json(own.map((k) => ({
      id: k.id,
      name: k.name,
      key_hint: k.key.slice(-4),
      created_at: k.createdAt,
    })));
  });
};

export const createKey = async (c: Context) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const body = await c.req.json<{ name?: string }>();
  if (!body.name || typeof body.name !== "string") {
    return c.json({ error: "name is required" }, 400);
  }

  const key = await createApiKey(body.name);
  return c.json({ id: key.id, name: key.name, key: key.key, created_at: key.createdAt }, 201);
};

export const deleteKey = async (c: Context) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const id = c.req.param("id") ?? "";
  const deleted = await deleteApiKey(id);
  if (!deleted) return c.json({ error: "Key not found" }, 404);
  return c.json({ ok: true });
};

export const rotateKey = async (c: Context) => {
  const denied = requireAdmin(c);
  if (denied) return denied;

  const id = c.req.param("id") ?? "";
  const key = await rotateApiKey(id);
  if (!key) return c.json({ error: "Key not found" }, 404);
  return c.json({ id: key.id, name: key.name, key: key.key, created_at: key.createdAt });
};
