import { displayModelName } from "../../lib/model-name.ts";
import type { UsageRecord } from "../../repo/types.ts";

const usageRecordKey = (record: UsageRecord): string =>
  `${record.keyId}\0${record.model}\0${record.hour}`;

export function aggregateUsageForDisplay(
  records: readonly UsageRecord[],
): UsageRecord[] {
  const byKey = new Map<string, UsageRecord>();

  for (const record of records) {
    // KEEP IN SYNC:
    // Dashboard token usage and Performance percentile grouping intentionally use
    // the same Claude base-model display identity. Storage/export/import remain
    // raw-model contracts; base-model grouping is query/display behavior only.
    const displayRecord: UsageRecord = {
      ...record,
      model: displayModelName(record.model),
      cacheReadTokens: record.cacheReadTokens ?? 0,
      cacheCreationTokens: record.cacheCreationTokens ?? 0,
    };
    const key = usageRecordKey(displayRecord);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, displayRecord);
      continue;
    }

    existing.requests += displayRecord.requests;
    existing.inputTokens += displayRecord.inputTokens;
    existing.outputTokens += displayRecord.outputTokens;
    existing.cacheReadTokens = (existing.cacheReadTokens ?? 0) +
      (displayRecord.cacheReadTokens ?? 0);
    existing.cacheCreationTokens = (existing.cacheCreationTokens ?? 0) +
      (displayRecord.cacheCreationTokens ?? 0);
  }

  return [...byKey.values()].sort((a, b) =>
    a.hour.localeCompare(b.hour) ||
    a.keyId.localeCompare(b.keyId) ||
    a.model.localeCompare(b.model)
  );
}
