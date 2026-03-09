// API key CRUD — multi-key support via Deno KV

import { kv } from "./kv.ts";

export interface ApiKey {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  lastUsedAt?: string;
}

function generateKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createApiKey(name: string): Promise<ApiKey> {
  const entry: ApiKey = {
    id: crypto.randomUUID(),
    name,
    key: generateKey(),
    createdAt: new Date().toISOString(),
  };
  await kv.set(["api_keys", entry.id], entry);
  return entry;
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const keys: ApiKey[] = [];
  for await (const entry of kv.list<ApiKey>({ prefix: ["api_keys"] })) {
    keys.push(entry.value);
  }
  return keys;
}

export async function renameApiKey(id: string, name: string): Promise<ApiKey | null> {
  const existing = await kv.get<ApiKey>(["api_keys", id]);
  if (!existing.value) return null;
  const updated: ApiKey = { ...existing.value, name };
  await kv.set(["api_keys", id], updated);
  return updated;
}

export async function rotateApiKey(id: string): Promise<ApiKey | null> {
  const existing = await kv.get<ApiKey>(["api_keys", id]);
  if (!existing.value) return null;
  const updated: ApiKey = {
    ...existing.value,
    key: generateKey(),
  };
  await kv.set(["api_keys", id], updated);
  return updated;
}

export async function deleteApiKey(id: string): Promise<boolean> {
  const existing = await kv.get(["api_keys", id]);
  if (!existing.value) return false;
  await kv.delete(["api_keys", id]);
  return true;
}

export async function validateApiKey(rawKey: string): Promise<{ id: string; name: string } | null> {
  for await (const entry of kv.list<ApiKey>({ prefix: ["api_keys"] })) {
    if (entry.value.key === rawKey) {
      return { id: entry.value.id, name: entry.value.name };
    }
  }
  return null;
}

/** Update lastUsedAt timestamp for a key (fire-and-forget, debounced by caller) */
export async function touchApiKeyLastUsed(id: string): Promise<void> {
  const existing = await kv.get<ApiKey>(["api_keys", id]);
  if (!existing.value) return;
  const updated: ApiKey = {
    ...existing.value,
    lastUsedAt: new Date().toISOString(),
  };
  await kv.set(["api_keys", id], updated);
}
