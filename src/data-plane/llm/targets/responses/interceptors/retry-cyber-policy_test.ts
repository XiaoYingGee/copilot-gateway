import { assertEquals } from "@std/assert";
import type {
  ResponsesPayload,
  ResponsesResult,
} from "../../../../../lib/responses-types.ts";
import type { EmitInput } from "../../emit-types.ts";
import { eventResult } from "../../../shared/errors/result.ts";
import { jsonFrame, sseFrame } from "../../../shared/stream/types.ts";
import { withCyberPolicyRetried } from "./retry-cyber-policy.ts";

const makePayload = (): ResponsesPayload => ({
  model: "gpt-test",
  input: "hi",
  instructions: null,
  temperature: 1,
  top_p: null,
  max_output_tokens: 32,
  tools: null,
  tool_choice: "auto",
  metadata: null,
  stream: true,
  store: false,
  parallel_tool_calls: true,
});

const makeInput = (payload: ResponsesPayload): EmitInput<ResponsesPayload> => ({
  sourceApi: "responses",
  payload,
  githubToken: "github-token",
  accountType: "individual",
});

const completedResponse = (): ResponsesResult => ({
  id: "resp_ok",
  object: "response",
  model: "gpt-test",
  status: "completed",
  output_text: "ok",
  output: [],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
});

const upstreamCyberPolicyError = (message: string) => ({
  type: "upstream-error" as const,
  status: 400,
  headers: new Headers({ "content-type": "application/json" }),
  body: new TextEncoder().encode(
    JSON.stringify({
      error: {
        message,
        type: "invalid_request_error",
        code: "cyber_policy",
      },
    }),
  ),
});

Deno.test("withCyberPolicyRetried retries fatal upstream cyber policy errors five times before returning success", async () => {
  const payload = makePayload();
  let attempts = 0;

  const result = await withCyberPolicyRetried(makeInput(payload), () => {
    attempts += 1;

    if (attempts < 6) {
      return Promise.resolve(upstreamCyberPolicyError(`blocked ${attempts}`));
    }

    return Promise.resolve(eventResult((async function* () {
      yield jsonFrame(completedResponse());
    })()));
  });

  assertEquals(attempts, 6);
  assertEquals(result.type, "events");
});

Deno.test("withCyberPolicyRetried retries fatal Responses SSE cyber policy failures before returning success", async () => {
  const payload = makePayload();
  let attempts = 0;

  const result = await withCyberPolicyRetried(makeInput(payload), () => {
    attempts += 1;

    if (attempts < 3) {
      return Promise.resolve(eventResult((async function* () {
        yield sseFrame(
          JSON.stringify({
            type: "response.failed",
            sequence_number: 1,
            response: {
              id: `resp_blocked_${attempts}`,
              object: "response",
              model: "gpt-test",
              status: "failed",
              output: [],
              output_text: "",
              error: {
                message: "This request was flagged for cyber policy.",
                type: "invalid_request_error",
                code: "cyber_policy",
              },
            },
          }),
          "response.failed",
        );
      })()));
    }

    return Promise.resolve(eventResult((async function* () {
      yield sseFrame(
        JSON.stringify({
          type: "response.completed",
          sequence_number: 1,
          response: completedResponse(),
        }),
        "response.completed",
      );
    })()));
  });

  assertEquals(attempts, 3);
  assertEquals(result.type, "events");
  if (result.type !== "events") throw new Error("expected events result");

  const frames = [];
  for await (const frame of result.events) frames.push(frame);
  assertEquals(frames.length, 1);
  assertEquals(
    frames[0],
    sseFrame(
      JSON.stringify({
        type: "response.completed",
        sequence_number: 1,
        response: completedResponse(),
      }),
      "response.completed",
    ),
  );
});

Deno.test("withCyberPolicyRetried returns successful streams without draining them", async () => {
  const payload = makePayload();
  let release!: () => void;
  let markStreamDrained!: () => void;
  const untilRelease = new Promise<void>((resolve) => release = resolve);
  const streamDrained = new Promise<"drained">((resolve) => {
    markStreamDrained = () => resolve("drained");
  });

  const resultPromise = withCyberPolicyRetried(
    makeInput(payload),
    () =>
      Promise.resolve(eventResult((async function* () {
        yield sseFrame(
          JSON.stringify({
            type: "response.output_text.delta",
            sequence_number: 1,
            delta: "ok",
          }),
          "response.output_text.delta",
        );

        markStreamDrained();
        await untilRelease;
        yield sseFrame(
          JSON.stringify({
            type: "response.completed",
            sequence_number: 2,
            response: completedResponse(),
          }),
          "response.completed",
        );
      })())),
  );

  const firstAction = await Promise.race([
    resultPromise.then(() => "returned" as const),
    streamDrained,
  ]);
  release();

  assertEquals(firstAction, "returned");
  const result = await resultPromise;
  assertEquals(result.type, "events");
  if (result.type !== "events") throw new Error("expected events result");

  const frames = [];
  for await (const frame of result.events) frames.push(frame);
  assertEquals(frames.length, 2);
});

Deno.test("withCyberPolicyRetried returns the final cyber policy failure after exhausting retries", async () => {
  const payload = makePayload();
  let attempts = 0;

  const result = await withCyberPolicyRetried(makeInput(payload), () => {
    attempts += 1;
    return Promise.resolve(upstreamCyberPolicyError(`blocked ${attempts}`));
  });

  assertEquals(attempts, 11);
  assertEquals(result.type, "upstream-error");
  if (result.type !== "upstream-error") {
    throw new Error("expected upstream-error result");
  }
  assertEquals(
    JSON.parse(new TextDecoder().decode(result.body)).error.message,
    "blocked 11",
  );
});
