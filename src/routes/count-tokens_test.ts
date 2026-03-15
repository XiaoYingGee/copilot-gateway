import { assertEquals } from "@std/assert";
import {
  resetTokenizersForTest,
  setAnthropicTokenizerForTest,
} from "./count-tokens.ts";
import { requestApp, setupAppTest } from "../test-helpers.ts";

Deno.test("/v1/messages/count_tokens falls back to estimation when tokenizer throws at runtime", async () => {
  const { apiKey } = await setupAppTest();

  setAnthropicTokenizerForTest(() => {
    throw new TypeError("malloc is not a function");
  });

  try {
    const response = await requestApp("/v1/messages/count_tokens", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey.key,
      },
      body: JSON.stringify({
        model: "claude-sonnet-4",
        max_tokens: 64,
        system: "abc",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    assertEquals(response.status, 200);
    assertEquals(await response.json(), { input_tokens: 7 });
  } finally {
    resetTokenizersForTest();
  }
});
