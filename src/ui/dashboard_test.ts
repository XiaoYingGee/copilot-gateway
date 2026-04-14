import { assertStringIncludes } from "@std/assert";
import { DashboardPage } from "./dashboard.tsx";

Deno.test("DashboardPage renders split dashboard shell", () => {
  const html = DashboardPage().toString();

  assertStringIncludes(html, 'x-data="dashboardApp()"');
  assertStringIncludes(html, "Copilot Gateway");
  assertStringIncludes(html, "API Keys");
  assertStringIncludes(html, "Total Tokens");
  assertStringIncludes(html, "Cache Hit Rate");
  assertStringIncludes(html, "function dashboardApp()");
});
