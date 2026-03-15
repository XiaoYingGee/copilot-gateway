# Data Plane Translation

## Overview

`copilot-deno` exposes three client-facing data plane APIs:

- `POST /v1/messages` — Anthropic Messages compatible endpoint
- `POST /v1/responses` — OpenAI Responses compatible endpoint
- `POST /v1/chat/completions` — OpenAI Chat Completions endpoint

Route selection is driven by `GET /models` capability data, specifically each
model's `supported_endpoints`. The implementation does not hardcode model
families.

## `/v1/messages` Routing

File: `src/routes/messages.ts`

The Messages route selects one of three paths:

1. Native Messages
   If the model supports `/v1/messages`, forward the Anthropic payload
   directly.
2. Responses translation
   If the model does not support `/v1/messages`, but supports `/responses` and
   does not support `/chat/completions`, translate Anthropic Messages ↔ OpenAI
   Responses.
3. Chat Completions translation
   Otherwise, translate Anthropic Messages ↔ OpenAI Chat Completions.

Current behavior:

- Anthropic tool `strict` is forwarded as-is on native `/v1/messages`.
- The gateway does not silently drop `strict` and does not reroute strict
  Messages requests to `/chat/completions`.
- If the upstream native Messages endpoint rejects `strict`, that `400` error
  is returned to the client.

## Native Messages Path

File: `src/routes/messages.ts`

When forwarding to native `/v1/messages`, the gateway applies only
compatibility workarounds that preserve Anthropic semantics:

- strip unsupported `web_search` tools
- strip reserved keyword `x-anthropic-billing-header` from text blocks
- filter invalid GPT-origin thinking blocks before native forwarding
- whitelist forwarded `anthropic-beta` values
- auto-add `interleaved-thinking-2025-05-14` for budget-based thinking when
  appropriate
- remove unsupported `service_tier`
- filter stray SSE `data: [DONE]` sentinels so the stream remains Anthropic
  shaped

The gateway does not inject `adaptive` thinking mode.

## Messages ↔ Chat Completions Translation

Files:

- `src/lib/translate/openai.ts`
- `src/lib/translate/openai-stream.ts`
- `src/lib/translate/chat-to-messages.ts`

This path is used only when native `/v1/messages` is unavailable.

### Anthropic Messages → Chat Completions

Main mappings:

- `system` becomes a leading Chat Completions system message
- Anthropic `text` blocks become assistant `content`
- Anthropic `tool_use` blocks become OpenAI `tool_calls`
- Anthropic `thinking` / `redacted_thinking` become `reasoning_text` /
  `reasoning_opaque`
- Anthropic tool definitions become OpenAI function tools
- Anthropic `tool_choice` maps to OpenAI `tool_choice`
- Anthropic `stop_reason` maps to OpenAI `finish_reason`

### Chat Completions → Anthropic Messages

Main mappings:

- system/developer messages are collected into top-level Anthropic `system`
- user / assistant / tool messages are regrouped into alternating Anthropic
  messages
- assistant blocks are ordered as `thinking` → `text` → `tool_use`
- OpenAI JSON-string tool arguments are parsed into Anthropic `input` objects
- `reasoning_text` / `reasoning_opaque` become Anthropic thinking blocks
- image parts are converted to Anthropic image blocks when possible

### Chat Completions Streaming

OpenAI streams use bare `data:` chunks and end with `[DONE]`. When translating
Chat Completions → Anthropic, the gateway consumes OpenAI chunks and emits
Anthropic SSE events such as:

- `message_start`
- `content_block_start`
- `content_block_delta`
- `content_block_stop`
- `message_delta`
- `message_stop`

## Messages ↔ Responses Translation

Files:

- `src/lib/translate/responses.ts`
- `src/lib/translate/responses-stream.ts`
- `src/lib/translate/anthropic-to-responses-stream.ts`

This path is used when a model supports `/responses` but not `/v1/messages`.

Main mappings:

- Anthropic system/developer content is normalized into Responses input items
- Anthropic tool definitions become Responses function tools
- Anthropic reasoning/thinking content is preserved using Responses reasoning
  items and encrypted content round-tripping
- Anthropic SSE is translated into named Responses SSE events with
  `sequence_number` and stable output item IDs

## `/v1/responses` Routing

File: `src/routes/responses.ts`

The Responses route selects one of two paths:

1. Direct Responses passthrough if the model supports `/responses`
2. Reverse translation through Anthropic Messages if the model only supports
   `/v1/messages`

## Key Current Constraints

- Native Anthropic-compatible streams must not expose `[DONE]`.
- `strict` support on Copilot upstream Claude models is inconsistent; the
  gateway intentionally does not mask this with implicit fallback.
- `count_tokens` uses tokenizer implementations when available and falls back
  to estimation on tokenizer load or runtime failure.

## Key Files

- `src/routes/messages.ts`
- `src/routes/responses.ts`
- `src/routes/chat-completions.ts`
- `src/routes/count-tokens.ts`
- `src/lib/translate/openai.ts`
- `src/lib/translate/openai-stream.ts`
- `src/lib/translate/chat-to-messages.ts`
- `src/lib/translate/responses.ts`
- `src/lib/translate/responses-stream.ts`
- `src/lib/translate/anthropic-to-responses-stream.ts`
