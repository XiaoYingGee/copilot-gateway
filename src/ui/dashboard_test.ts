import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import { DashboardPage } from "./dashboard.tsx";

function extractDashboardScript() {
  const html = DashboardPage().toString();
  const scripts = html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g);
  for (const script of scripts) {
    if (script[1].includes("function dashboardApp()")) return script[1];
  }
  throw new Error("dashboard script not found");
}

function createDashboardHarness() {
  const charts: any[] = [];
  class FakeChart {
    canvas: unknown;
    data: any;
    options: any;
    visibility = new Map<number, boolean>();
    lastUpdateMode: string | null = null;

    constructor(canvas: unknown, config: any) {
      this.canvas = canvas;
      this.data = config.data;
      this.options = config.options;
      charts.push(this);
    }

    stop() {}
    destroy() {}

    setDatasetVisibility(index: number, visible: boolean) {
      this.visibility.set(index, visible);
    }

    update(mode: string) {
      this.lastUpdateMode = mode;
    }
  }

  const localStorage = {
    getItem(key: string) {
      if (key === "authKey") return "test-key";
      if (key === "isAdmin") return "1";
      return null;
    },
    removeItem() {},
  };
  const location = { hash: "#usage", origin: "https://example.test" };
  const window = { addEventListener() {}, location };
  const document = {
    getElementById(id: string) {
      return { id, clientWidth: 640 };
    },
  };

  const dashboardApp = new Function(
    "localStorage",
    "location",
    "window",
    "document",
    "Chart",
    extractDashboardScript() + "\nreturn dashboardApp;",
  )(localStorage, location, window, document, FakeChart);

  return { app: dashboardApp(), charts };
}

function usageRecord(offsetHours: number, overrides: Record<string, unknown>) {
  const date = new Date();
  date.setHours(date.getHours() + offsetHours, 0, 0, 0);
  return {
    hour: date.toISOString().slice(0, 13),
    keyId: "key_1",
    keyName: "Primary",
    model: "model-a",
    requests: 1,
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    ...overrides,
  };
}

Deno.test("DashboardPage renders split dashboard shell", () => {
  const html = DashboardPage().toString();

  assertStringIncludes(html, 'x-data="dashboardApp()"');
  assertStringIncludes(html, "Copilot Gateway");
  assertStringIncludes(html, "API Keys");
  assertStringIncludes(html, "Total Tokens");
  assertStringIncludes(html, "Cache Hit Rate");
  assertStringIncludes(html, "function dashboardApp()");
});

Deno.test("DashboardPage renders the search section below the usage cards without architecture labels", () => {
  const html = DashboardPage().toString();

  assertStringIncludes(html, "Search Provider");
  assertStringIncludes(html, "Tavily");
  assertStringIncludes(html, "Microsoft Grounding");
  assertStringIncludes(html, "Save Search Config");
  assertStringIncludes(html, "Test Search");
  assertStringIncludes(
    html,
    ":disabled=\"!searchConfigLoaded || searchConfigTesting || searchConfigDraft.provider === 'disabled'\"",
  );
  assertFalse(html.includes("Control Plane"));
  assertFalse(html.includes("Data Plane"));
  assertFalse(
    html.indexOf("Search Provider") < html.indexOf("Premium Requests"),
  );
});

Deno.test("DashboardPage renders helper functions inside script without HTML entity encoding", () => {
  const html = DashboardPage().toString();

  assertStringIncludes(html, "const draftFromSearchConfig = ");
  assertStringIncludes(html, "const activeCredentialValue = ");
  assertStringIncludes(html, "const setActiveCredentialValue = ");
  assertStringIncludes(html, "const searchConfigFromDraft = ");
  assertFalse(html.includes("=&gt;"));
  assertFalse(html.includes("&quot;tavily&quot;"));
});

Deno.test("DashboardPage renders clickable usage summary metrics for chart axis selection", () => {
  const html = DashboardPage().toString();

  assertStringIncludes(html, "tokenChartMetric: 'total'");
  assertStringIncludes(html, "@click=\"switchTokenChartMetric('requests')\"");
  assertStringIncludes(html, "@click=\"switchTokenChartMetric('total')\"");
  assertStringIncludes(html, "@click=\"switchTokenChartMetric('input')\"");
  assertStringIncludes(html, "@click=\"switchTokenChartMetric('output')\"");
  assertStringIncludes(
    html,
    "@click=\"switchTokenChartMetric('cacheCreation')\"",
  );
  assertStringIncludes(
    html,
    "@click=\"switchTokenChartMetric('cacheHitRate')\"",
  );
  assertStringIncludes(html, ":class=\"tokenChartMetric === 'total'");
});

Deno.test("DashboardPage preserves empty cache hit rate chart points", () => {
  const html = DashboardPage().toString();

  assertStringIncludes(
    html,
    "return total > 0 ? (detail.cacheRead / total) * 100 : null;",
  );
  assertStringIncludes(
    html,
    "return this.tokenChartMetric === 'cacheHitRate' ? null : 0;",
  );
  assertStringIncludes(
    html,
    "item.parsed.y !== null && (self.tokenChartMetric === 'cacheHitRate' || item.parsed.y > 0)",
  );
});

Deno.test("DashboardPage connects cache hit rate lines across empty points", () => {
  const html = DashboardPage().toString();

  assertStringIncludes(
    html,
    "ds.spanGaps = metric === 'cacheHitRate';",
  );
  assertStringIncludes(
    html,
    "spanGaps: self.tokenChartMetric === 'cacheHitRate'",
  );
});

Deno.test("dashboardApp updates chart data and options when switching summary metrics", () => {
  const { app, charts } = createDashboardHarness();
  app.tokenData = [
    usageRecord(-2, {
      requests: 2,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 5,
      cacheCreationTokens: 5,
    }),
    usageRecord(-1, {
      requests: 3,
      inputTokens: 20,
      outputTokens: 7,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    }),
    usageRecord(0, {
      requests: 4,
      inputTokens: 6,
      outputTokens: 4,
      cacheReadTokens: 3,
      cacheCreationTokens: 1,
    }),
  ];

  app.renderTokenCharts();
  assertEquals(charts.length, 2);
  for (const chart of charts) {
    assertEquals(chart.options.scales.y.title.text, "Total Tokens");
    assertEquals(chart.options.scales.y.stacked, true);
    assertEquals(chart.data.datasets[0].fill, "stack");
    assertEquals(chart.data.datasets[0].spanGaps, false);
    assertFalse(chart.data.datasets[0].data.includes(null));
    assert(chart.data.datasets[0].data.includes(15));
    assert(chart.data.datasets[0].data.includes(27));
    assert(chart.data.datasets[0].data.includes(10));
  }

  app.switchTokenChartMetric("cacheHitRate");
  assertEquals(app.tokenChartMetric, "cacheHitRate");
  for (const chart of charts) {
    assertEquals(chart.options.scales.y.title.text, "Cache Hit Rate");
    assertEquals(chart.options.scales.y.stacked, false);
    assertEquals(chart.options.scales.y.suggestedMax, 100);
    assertEquals(chart.data.datasets[0].fill, false);
    assertEquals(chart.data.datasets[0].spanGaps, true);
    assert(chart.data.datasets[0].data.includes(50));
    assert(chart.data.datasets[0].data.includes(75));
    assert(chart.data.datasets[0].data.includes(null));
  }

  app.switchTokenChartMetric("requests");
  assertEquals(app.tokenChartMetric, "requests");
  for (const chart of charts) {
    assertEquals(chart.options.scales.y.title.text, "Requests");
    assertEquals(chart.options.scales.y.stacked, true);
    assertEquals(chart.options.scales.y.suggestedMax, undefined);
    assertEquals(chart.data.datasets[0].fill, "stack");
    assertEquals(chart.data.datasets[0].spanGaps, false);
    assertFalse(chart.data.datasets[0].data.includes(null));
    assert(chart.data.datasets[0].data.includes(2));
    assert(chart.data.datasets[0].data.includes(3));
    assert(chart.data.datasets[0].data.includes(4));
  }
});

Deno.test("DashboardPage usage summary metric focus styling only shows borders on hover or focus-visible", () => {
  const html = DashboardPage().toString();

  assertStringIncludes(
    html,
    "border border-transparent cursor-pointer transition-colors hover:border-white/10 focus:outline-none focus-visible:border-accent-cyan/40",
  );
  assertFalse(html.includes("focus:ring"));
});
