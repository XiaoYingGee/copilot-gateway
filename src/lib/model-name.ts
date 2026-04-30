// Low-level Claude syntax helpers. The LLM compatibility resolver owns route-time
// model selection; this module only converts dashed Claude version aliases into
// Copilot's dotted upstream form for lookup/fallback paths.

const CLAUDE_MINOR_VERSION_DATE_SUFFIX = /^(.*(?:\d+\.\d+|\d+-\d+))-\d{8}$/;

/** Canonical upstream form — for calls into Copilot. */
export function normalizeModelName(id: string): string {
  if (!id.startsWith("claude-")) return id;
  return id.replace(/(?<=-)(\d+)-(\d+)(?=-|$)/g, "$1.$2");
}

export function dateSuffixedClaudeModelAliasTarget(
  id: string,
): string | undefined {
  if (!id.startsWith("claude-")) return undefined;
  const match = id.match(CLAUDE_MINOR_VERSION_DATE_SUFFIX);
  return match ? normalizeModelName(match[1]) : undefined;
}
