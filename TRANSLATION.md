# Data Plane Translation

This document describes the current translation behavior between the three
client-facing data-plane APIs:

- Anthropic Messages: `POST /v1/messages`
- OpenAI Responses: `POST /v1/responses`
- OpenAI Chat Completions: `POST /v1/chat/completions`

Route planning uses model capability data from `supported_endpoints`. Request
translation is direct and pairwise; there is no canonical internal request IR.
Target-specific Copilot quirks live at target interceptors rather than inside
pairwise translators.

## Routing

`/v1/messages` selects:

1. native `/v1/messages`
2. translated `/responses`
3. translated `/chat/completions`

`/v1/responses` selects:

1. native `/responses`
2. translated `/v1/messages`
3. translated `/chat/completions`

`/v1/chat/completions` selects:

1. translated `/v1/messages`
2. native `/chat/completions`
3. translated `/responses`

If Chat planning cannot derive capabilities, it keeps the legacy heuristic:
Claude-prefixed models use the Messages target; other models use the Chat
Completions target.

## Boundary Rules

- Pairwise translators preserve source semantics where the target API has a
  natural counterpart.
- Translators do not synthesize defaults merely to satisfy a target shape.
  Examples: no translated-only `temperature: 1`, `store: false`,
  `parallel_tool_calls: true`, or `reasoning.summary: "detailed"`.
- Fields with no natural target-side meaning are omitted instead of encoded into
  private bridges.
- Copilot target quirks such as unsupported `service_tier`, token floors,
  connection-bound IDs, and malformed upstream stream shapes are handled at the
  target boundary.
- Streaming results are source-shaped event streams after upstream emission.
  Source responders decide final HTTP/SSE shaping.

## Boundary Workarounds

Messages source boundary:

- strips reserved `x-anthropic-billing-header` prompt attribution
- strips unsupported `cache_control.scope`
- removes unsupported `web_search` tools before planning/emission
- rewrites upstream context-window errors into the compact Messages error shape

Responses source boundary:

- rewrites `apply_patch` from `custom` to `function`
- removes unsupported `image_generation` tools and forced tool choices before
  planning/emission

Native Messages target:

- strips unsupported `service_tier`
- filters invalid thinking blocks before native forwarding
- whitelists supported `anthropic-beta` values
- auto-adds `interleaved-thinking-2025-05-14` when budget thinking requires it
- rewrites native `web_search` tools through the gateway shim
- strips stray `[DONE]` sentinels from Anthropic-shaped streams

Native Responses target:

- strips unsupported `service_tier`
- raises too-small `max_output_tokens` when the Copilot target requires it
- retries expired connection-bound input IDs once with deterministic rewrites
- synchronizes mismatched stream output item IDs

Native Chat Completions target:

- strips unsupported `service_tier`
- forces upstream streaming usage when needed for gateway accounting
- normalizes Claude split choice shapes and streaming choice indices

The Chat source still only exposes final usage-only SSE chunks to clients when
the caller requested `stream_options.include_usage: true`. Hidden upstream usage
is preserved separately for gateway accounting.

## Messages To Responses

Request mapping:

- `system` becomes Responses `instructions`; multi-block system text is joined
  with blank lines.
- user text and images become Responses `message` input content.
- user `tool_result` blocks become `function_call_output` items, preserving
  source order relative to user text by splitting input items when necessary.
- assistant text becomes `message` items with `output_text` content.
- assistant `tool_use` blocks become `function_call` items.
- assistant `thinking` and `redacted_thinking` blocks become `reasoning` input
  items; `signature` / redacted data maps to `encrypted_content`.
- `max_tokens`, `temperature`, `top_p`, `metadata`, and `stream` pass through
  when present.
- `output_config.effort` maps directly to `reasoning.effort`; disabled thinking
  maps to `reasoning.effort: "none"`; enabled thinking without explicit effort
  is omitted.
- `include: ["reasoning.encrypted_content"]` is added when explicit request-side
  reasoning is present.
- Messages tools become Responses function tools. Omitted Messages `strict`
  becomes Responses `strict: false`, preserving non-strict default behavior.
- `tool_choice` maps `auto` -> `auto`, `any` -> `required`, named tool -> named
  function, and `none` -> `none`.

Response mapping:

- assistant `thinking` / `redacted_thinking` output becomes Responses
  `reasoning` output items.
- assistant text becomes `message` output items and contributes to
  `output_text`.
- assistant `tool_use` becomes `function_call` output items.
- `max_tokens` stop maps to `status: "incomplete"`; other normal stops map to
  `status: "completed"`.
- cache read tokens map to Responses `input_tokens_details.cached_tokens`.
- Output item order follows the original assistant block order.

Known losses:

- `stop_sequences`, `top_k`, and Messages `service_tier` have no Responses
  request counterpart and are omitted.
- Responses reasoning IDs are regenerated; they are not packed into Anthropic
  signatures. This may reduce prompt-cache fidelity but keeps opaque signatures
  semantically clean.
- Anthropic `thinking: { type: "enabled" }` without explicit effort has no
  Responses request-side equivalent and is not emulated.

## Responses To Messages

Request mapping:

- `instructions` and input `system` / `developer` messages become top-level
  Messages `system`, joined with blank lines.
- string input becomes one user message.
- user `input_text` becomes Messages text; `input_image` URLs are resolved via
  the shared remote-image loader and converted to base64 image blocks when
  supported.
- assistant `output_text` becomes assistant text blocks.
- `function_call` becomes assistant `tool_use`.
- `function_call_output` becomes user `tool_result`; incomplete status marks the
  tool result as an error.
- `reasoning` with readable summary becomes `thinking`; opaque-only reasoning
  becomes `redacted_thinking`; `encrypted_content` maps to `signature` / data.
- `max_output_tokens`, `temperature`, `top_p`, and `stream` pass through when
  present.
- `reasoning.effort: "none"` maps to disabled thinking; any other explicit
  effort maps to `output_config.effort`.
- Responses function tools become Messages tools, preserving explicit `strict`.
- Responses `tool_choice` maps to the corresponding Messages tool choice when
  representable.

Response mapping:

- Responses output items are converted in output order.
- `reasoning` maps to `thinking` or `redacted_thinking`.
- `message` content maps to text. `refusal` content is kept visible as text
  because Messages has no local refusal block.
- `function_call` maps to `tool_use`.
- `completed` maps to `end_turn` or `tool_use`; max-output incomplete maps to
  `max_tokens`.
- cached input tokens are subtracted from Anthropic `input_tokens` and exposed
  as `cache_read_input_tokens`.

Known losses:

- generic Responses `metadata` is omitted; it is not coerced into
  `metadata.user_id`.
- `previous_response_id` and other Responses-native state are not emulated on
  translated Messages paths.
- Remote image fetch failures and unsupported image media types drop that image
  rather than failing the request.

## Messages To Chat Completions

Request mapping:

- top-level Messages `system` becomes a leading Chat `system` message.
- user text and images become Chat user content.
- user `tool_result` blocks become Chat `tool` messages. Mixed user text and
  tool results are split into multiple Chat messages to preserve source order.
- assistant text becomes Chat assistant `content`.
- assistant `tool_use` blocks become OpenAI `tool_calls`.
- assistant `thinking` / `redacted_thinking` projects only the first
  source-order scalar reasoning group into Chat `reasoning_text` /
  `reasoning_opaque`.
- `max_tokens`, `stop_sequences` -> `stop`, `stream`, `temperature`, and `top_p`
  pass through when present.
- streaming translated requests force upstream `stream_options.include_usage` so
  gateway accounting can see usage.
- Messages tools become OpenAI function tools; explicit `strict` is preserved
  and omitted `strict` remains omitted.
- Messages `tool_choice` maps to OpenAI `tool_choice` where representable.

Response mapping:

- assistant text blocks concatenate into Chat assistant `content`.
- `tool_use` blocks become `tool_calls`.
- only the first source-order reasoning group is projected into scalar Chat
  reasoning fields.
- usage maps to Chat prompt/completion tokens; cache read tokens become
  `prompt_tokens_details.cached_tokens`.
- `tool_use` stop maps to `tool_calls`; `max_tokens` maps to `length`; other
  normal stops map to `stop`.

Known losses:

- multiple Messages thinking blocks cannot be represented losslessly in legacy
  Chat scalar fields. Later groups are omitted rather than aggregated or
  mismatched.
- assistant-side images have no Chat counterpart and are omitted.
- `top_k`, `service_tier`, and other Messages-only fields are omitted.

## Chat Completions To Messages

Request mapping:

- Chat `system` and `developer` messages become top-level Messages `system`,
  joined with blank lines.
- Chat user text and supported images become Messages user blocks. Remote images
  are resolved through the shared loader.
- Chat assistant `content` becomes assistant text.
- Chat assistant scalar `reasoning_text` / `reasoning_opaque` becomes one
  `thinking` block or one `redacted_thinking` block.
- Chat assistant `tool_calls` become Messages `tool_use` blocks.
- Chat `tool` messages become Messages `tool_result` blocks.
- `max_tokens`, `temperature`, `top_p`, `stop`, `stream`, tools, and tool choice
  map where representable.
- OpenAI function tools preserve explicit `strict`; omitted `strict` stays
  omitted.

Response mapping:

- multiple Chat choices are merged into one Messages response.
- scalar reasoning blocks are emitted before text, and text before tool use.
- scalar opaque-only reasoning becomes `redacted_thinking` rather than fake
  readable thinking.
- Chat usage maps to Messages usage; cached prompt tokens become
  `cache_read_input_tokens`.

Known losses:

- Chat `message.name`, legacy `user`, and generic Chat metadata are omitted on
  translated Messages paths.
- Chat `reasoning_items[]` is not a Messages bridge; it is only used for the
  Chat <-> Responses path.
- Chat image `detail` is not represented in Messages.
- Multiple choices lose choice index and separation.

## Chat Completions To Responses

Request mapping:

- only the initial contiguous Chat `system` prefix becomes Responses
  `instructions`.
- later `system` messages and all `developer` messages remain ordered Responses
  input messages.
- user content becomes Responses user input content.
- assistant text becomes Responses assistant `output_text` content.
- assistant `tool_calls` become `function_call` input items.
- Chat `tool` messages become `function_call_output` input items.
- Chat `reasoning_items[]` is preferred as the lossless Responses reasoning
  carrier. If absent, scalar `reasoning_text` / `reasoning_opaque` becomes one
  Responses `reasoning` item.
- `temperature`, `top_p`, `max_tokens` -> `max_output_tokens`, `metadata`,
  `stream`, `store`, `parallel_tool_calls`, `prompt_cache_key`,
  `safety_identifier`, and `service_tier` pass through when present.
- `reasoning_effort` maps directly to `reasoning.effort` only when explicit.
- `response_format` maps directly to Responses `text.format`, including explicit
  `null`.
- `include: ["reasoning.encrypted_content"]` is always requested so opaque
  reasoning can round-trip.
- OpenAI function tools become Responses tools. Explicit `strict` is preserved;
  omitted Chat `strict` becomes Responses `strict: false`.

Response mapping:

- Chat `reasoning_items[]` is preferred over scalar reasoning and becomes
  Responses reasoning output items.
- scalar reasoning becomes one Responses reasoning output item when no carrier
  is present.
- Chat content becomes one Responses `message` output item.
- Chat tool calls become Responses `function_call` output items.
- terminal Responses output is ordered by `output_index`, not completion time.
- `length` maps to `status: "incomplete"`; other finish reasons map to
  `completed`.

Known losses:

- Chat `stop` has no Responses request counterpart and is omitted.
- legacy Chat `user` is omitted on translated Chat/Responses paths.

## Responses To Chat Completions

Request mapping:

- `instructions` becomes a leading Chat `system` message.
- string input becomes a user message.
- input `message` items become Chat messages with matching roles.
- input `reasoning` items attach to the surrounding assistant message as
  `reasoning_items[]`; the first scalar-eligible group also projects to
  `reasoning_text` / `reasoning_opaque`.
- `function_call` items become assistant `tool_calls`.
- `function_call_output` items become Chat `tool` messages.
- `max_output_tokens`, `stream`, `temperature`, `top_p`, `metadata`, `store`,
  `parallel_tool_calls`, `prompt_cache_key`, `safety_identifier`,
  `service_tier`, and explicit `reasoning.effort` pass through when present.
- Responses `text.format` maps directly to Chat `response_format`; `text: {}`
  omits `response_format`, while `text: null` stays explicit `null`.
- Responses function tools become Chat function tools, preserving `strict`.

Response mapping:

- Responses `message` output text becomes Chat assistant `content`; refusal text
  is kept visible as text.
- Responses `function_call` output becomes Chat `tool_calls`.
- every Responses reasoning output item is preserved in Chat
  `reasoning_items[]`.
- legacy scalar `reasoning_text` / `reasoning_opaque` projects only the first
  scalar-eligible reasoning group.
- max-output incomplete maps to Chat `finish_reason: "length"`; completed with
  tool calls maps to `tool_calls`; other completed responses map to `stop`.

Known losses:

- Responses request-level `reasoning` has no Chat request counterpart except
  explicit effort.
- `previous_response_id` and other Responses-native state are not emulated on
  translated Chat paths.
- multiple opaque reasoning blobs are never concatenated into scalar
  `reasoning_opaque`; use `reasoning_items[]` for lossless transport.

## Streaming Semantics

- Anthropic-shaped streams never expose `[DONE]` to Messages clients.
- Chat-shaped streams use OpenAI `data:` chunks and may expose a final
  usage-only chunk only when the caller requested it.
- Responses-shaped streams use named Responses SSE events with monotonically
  increasing `sequence_number`.
- Chat -> Responses stream translation buffers scalar reasoning until it knows
  whether `reasoning_items[]` will be used, avoiding orphan or duplicated
  Responses reasoning items.
- Responses -> Chat and Responses -> Messages stream translation preserve output
  order when later visible output arrives before earlier reasoning/tool output
  is complete.
- Chat -> Messages stream translation keeps opaque-only reasoning in source
  order and flushes pending final usage before `message_stop`.
- Tool/function argument streams guard against infinite whitespace in generated
  arguments and emit an error rather than continuing a degenerate stream.

## Reasoning Policy

- Chat `reasoning_items[]` is the lossless Chat <-> Responses carrier for
  Responses reasoning items.
- legacy Chat scalar reasoning fields represent exactly one scalar group: text
  plus matching opaque payload, text only, or opaque only.
- scalar reasoning fields never aggregate multiple readable thinking blocks and
  never pair readable text with an unrelated opaque payload.
- Anthropic `redacted_thinking`, Responses `encrypted_content`, and Chat
  `reasoning_opaque` carry the same opaque model-side payload where the target
  API can represent it.
- Responses reasoning IDs are not encoded into Anthropic signatures.

## Standard OpenAI Field Policy

For translated Chat <-> Responses paths, same-purpose OpenAI fields pass through
directly where both APIs define them:

- `metadata`
- `store`
- `parallel_tool_calls`
- `response_format` / `text.format`
- `prompt_cache_key`
- `safety_identifier`
- explicit `reasoning_effort` / `reasoning.effort`

These fields are not bridged through Anthropic Messages-only paths unless the
Messages API has an explicit equivalent.
