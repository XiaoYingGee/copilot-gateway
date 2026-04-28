// Display/normalization for model names.
// Copilot's upstream uses dot-separated versions for Claude models
// (e.g. "claude-opus-4.7"), but Anthropic's canonical form uses dashes
// (e.g. "claude-opus-4-7"). The dashboard UI displays/generates the dashed
// form (see substituteModelName in src/ui/dashboard/client.tsx), and this
// function normalizes that alias back to the dotted form at the API entry.

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
