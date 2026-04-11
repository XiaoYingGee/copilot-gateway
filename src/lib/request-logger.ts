/**
 * Per-key request logger — writes structured JSON logs to hourly files.
 *
 * Layout: logs/{keyName}/{YYYY-MM-DD-HH}.jsonl
 * Retention: 30 days (cleanup runs hourly)
 */

const LOGS_DIR = "logs";
const RETENTION_DAYS = 30;

interface RequestLogEntry {
  ts: string;
  keyId: string;
  keyName: string;
  model: string;
  endpoint: string;
  cacheControlBefore: Record<string, unknown>[];
  cacheControlAfter: Record<string, unknown>[];
  systemLength: number;
  messageCount: number;
  systemHash: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  } | null;
  durationMs: number;
  status: number;
}

function hourlyFileName(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  return `${y}-${m}-${d}-${h}.jsonl`;
}

function sanitizeKeyName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";
}

async function ensureDir(path: string): Promise<void> {
  try {
    await Deno.mkdir(path, { recursive: true });
  } catch (e) {
    if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
  }
}

export async function writeLog(entry: RequestLogEntry): Promise<void> {
  try {
    const dir = `${LOGS_DIR}/${sanitizeKeyName(entry.keyName)}`;
    await ensureDir(dir);
    const file = `${dir}/${hourlyFileName()}`;
    const line = JSON.stringify(entry) + "\n";
    await Deno.writeTextFile(file, line, { append: true });
  } catch (e) {
    console.error("[request-logger] write error:", e);
  }
}

export function extractCacheControlMarkers(payload: {
  system?: unknown[];
  messages?: { content?: unknown[] | string }[];
}): Record<string, unknown>[] {
  const markers: Record<string, unknown>[] = [];
  // deno-lint-ignore no-explicit-any
  const collect = (block: any, source: string) => {
    if (block?.cache_control && typeof block.cache_control === "object") {
      markers.push({ source, ...block.cache_control });
    }
  };
  if (Array.isArray(payload.system)) {
    for (const b of payload.system) collect(b, "system");
  }
  if (Array.isArray(payload.messages)) {
    // Only check last 3 messages to limit log size
    const msgs = payload.messages.slice(-3);
    for (const msg of msgs) {
      if (Array.isArray(msg.content)) {
        for (const b of msg.content) collect(b, "message");
      }
    }
  }
  return markers;
}

/** Delete log files older than RETENTION_DAYS */
export async function cleanupOldLogs(): Promise<number> {
  let deleted = 0;
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  try {
    for await (const keyDir of Deno.readDir(LOGS_DIR)) {
      if (!keyDir.isDirectory) continue;
      const dirPath = `${LOGS_DIR}/${keyDir.name}`;
      for await (const file of Deno.readDir(dirPath)) {
        if (!file.name.endsWith(".jsonl")) continue;
        const filePath = `${dirPath}/${file.name}`;
        try {
          const stat = await Deno.stat(filePath);
          if (stat.mtime && stat.mtime.getTime() < cutoff) {
            await Deno.remove(filePath);
            deleted++;
          }
        } catch { /* skip unreadable files */ }
      }
      // Remove empty dirs
      try {
        const entries = [];
        for await (const e of Deno.readDir(dirPath)) entries.push(e);
        if (entries.length === 0) await Deno.remove(dirPath);
      } catch { /* ignore */ }
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      console.error("[request-logger] cleanup error:", e);
    }
  }
  return deleted;
}
