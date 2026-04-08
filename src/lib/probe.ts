import { getRepo } from "../repo/mod.ts";

interface ProbeCacheEntry<T> {
  probedAt: number;
  value: T;
}

export interface ProbeRequest<T> {
  key: string;
  version: string;
  ttlMs: number;
  scope: Record<string, string | number | boolean | undefined>;
  probe: () => Promise<T>;
  validate: (value: unknown) => value is T;
}

const PROBE_CACHE_KEY_PREFIX = "probe_cache_v1";
const inProcessCache = new Map<string, ProbeCacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

export function clearProbeCache(): void {
  inProcessCache.clear();
  inFlight.clear();
}

function isFresh(
  entry: ProbeCacheEntry<unknown>,
  ttlMs: number,
  now: number,
): boolean {
  return now - entry.probedAt < ttlMs;
}

function serializeScope(scope: ProbeRequest<unknown>["scope"]): string {
  return JSON.stringify(
    Object.entries(scope)
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

async function probeCacheKey(
  key: string,
  version: string,
  scope: ProbeRequest<unknown>["scope"],
): Promise<string> {
  const raw = `${key}:${version}:${serializeScope(scope)}`;
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${PROBE_CACHE_KEY_PREFIX}:${key}:${version}:${hash}`;
}

async function readRepoCache<T>(
  cacheKey: string,
  validate: (value: unknown) => value is T,
): Promise<ProbeCacheEntry<T> | null> {
  try {
    const raw = await getRepo().cache.get(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProbeCacheEntry<unknown>;
    if (typeof parsed?.probedAt !== "number" || !validate(parsed.value)) {
      return null;
    }
    return parsed as ProbeCacheEntry<T>;
  } catch {
    return null;
  }
}

async function writeRepoCache<T>(
  cacheKey: string,
  entry: ProbeCacheEntry<T>,
): Promise<void> {
  try {
    await getRepo().cache.set(cacheKey, JSON.stringify(entry));
  } catch {
    // Probe cache is an optimization; probe results are still usable without persistence.
  }
}

export async function getOrProbe<T>(request: ProbeRequest<T>): Promise<T> {
  const now = Date.now();
  const cacheKey = await probeCacheKey(
    request.key,
    request.version,
    request.scope,
  );

  const inProcessEntry = inProcessCache.get(cacheKey);
  if (
    inProcessEntry && isFresh(inProcessEntry, request.ttlMs, now) &&
    request.validate(inProcessEntry.value)
  ) {
    return inProcessEntry.value;
  }

  const repoEntry = await readRepoCache(cacheKey, request.validate);
  if (repoEntry && isFresh(repoEntry, request.ttlMs, now)) {
    inProcessCache.set(cacheKey, repoEntry);
    return repoEntry.value;
  }

  const existingProbe = inFlight.get(cacheKey) as Promise<T> | undefined;
  if (existingProbe) return await existingProbe;

  const probePromise = (async () => {
    const value = await request.probe();
    const entry: ProbeCacheEntry<T> = { probedAt: Date.now(), value };
    inProcessCache.set(cacheKey, entry);
    await writeRepoCache(cacheKey, entry);
    return value;
  })();

  inFlight.set(cacheKey, probePromise);

  try {
    return await probePromise;
  } finally {
    inFlight.delete(cacheKey);
  }
}
