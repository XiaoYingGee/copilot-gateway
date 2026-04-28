import { assertEquals } from "@std/assert";
import { normalizeModelName } from "./model-name.ts";

Deno.test("normalizeModelName maps dashed Claude minor versions to Copilot dotted IDs", () => {
  assertEquals(normalizeModelName("claude-opus-4-7"), "claude-opus-4.7");
});

Deno.test("normalizeModelName keeps date suffixes for model lookup to resolve", () => {
  assertEquals(
    normalizeModelName("claude-opus-4.7-20251001"),
    "claude-opus-4.7-20251001",
  );
  assertEquals(
    normalizeModelName("claude-opus-4-7-20251001"),
    "claude-opus-4.7-20251001",
  );
  assertEquals(
    normalizeModelName("claude-haiku-4-5-20251001"),
    "claude-haiku-4.5-20251001",
  );
});

Deno.test("normalizeModelName leaves non-Claude models unchanged", () => {
  assertEquals(normalizeModelName("gpt-4-1-20251001"), "gpt-4-1-20251001");
});
