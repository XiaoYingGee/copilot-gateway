import { assertEquals, assertFalse } from "@std/assert";
import type { ResponsesPayload } from "../../../../../lib/responses-types.ts";
import { stripUnsupportedResponsesTools } from "./strip-unsupported-tools.ts";

Deno.test("stripUnsupportedResponsesTools removes image_generation tools", () => {
  const payload = {
    model: "gpt-test",
    input: "draw this",
    tools: [
      { type: "image_generation" },
      {
        type: "function",
        name: "lookup",
        parameters: { type: "object" },
        strict: false,
      },
    ],
    tool_choice: "auto",
  } as unknown as ResponsesPayload;

  stripUnsupportedResponsesTools(payload);

  assertEquals(payload.tools?.length, 1);
  assertEquals(payload.tools?.[0].type, "function");
  assertEquals(payload.tool_choice, "auto");
});

Deno.test("stripUnsupportedResponsesTools removes forced image_generation tool_choice", () => {
  const payload = {
    model: "gpt-test",
    input: "draw this",
    tools: [{ type: "image_generation" }],
    tool_choice: { type: "image_generation" },
  } as unknown as ResponsesPayload;

  stripUnsupportedResponsesTools(payload);

  assertFalse("tools" in payload);
  assertFalse("tool_choice" in payload);
});

Deno.test("stripUnsupportedResponsesTools removes required tool_choice when no tools remain", () => {
  const payload = {
    model: "gpt-test",
    input: "draw this",
    tools: [{ type: "image_generation" }],
    tool_choice: "required",
  } as unknown as ResponsesPayload;

  stripUnsupportedResponsesTools(payload);

  assertFalse("tools" in payload);
  assertFalse("tool_choice" in payload);
});
