import type { SearchConfig } from "../../data-plane/tools/web-search/types.ts";
import type {
  ApiKey,
  GitHubAccount,
  PerformanceTelemetryRecord,
  SearchUsageRecord,
  UsageRecord,
} from "../../repo/types.ts";

export interface ExportPayload {
  version: 1;
  exportedAt: string;
  data: {
    apiKeys: ApiKey[];
    githubAccounts: GitHubAccount[];
    usage: UsageRecord[];
    searchUsage: SearchUsageRecord[];
    performance?: PerformanceTelemetryRecord[];
    performanceIncluded?: boolean;
    searchConfig: SearchConfig;
  };
}
