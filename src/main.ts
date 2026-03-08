// copilot-deno — GitHub Copilot API proxy for Deno Deploy
//
// Exposes:
//   POST /v1/chat/completions   (OpenAI-compatible, passthrough)
//   POST /v1/messages           (Anthropic-compatible, translated)
//   GET  /v1/models
//
// Auth: static key via ?key=, x-api-key header, or Authorization: Bearer header
// Copilot token: lazily fetched from GitHub, cached in-memory with auto-expiry

import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { chatCompletions } from "./routes/chat-completions.ts";
import { models } from "./routes/models.ts";
import { messages } from "./routes/messages.ts";
import { authMiddleware } from "./middleware/auth.ts";

const app = new Hono();

app.use("*", logger());
app.use("*", cors());
app.use("*", authMiddleware);

// Health check
app.get("/", (c) =>
  c.json({ status: "ok", service: "copilot-deno" })
);

// OpenAI-compatible
app.post("/v1/chat/completions", chatCompletions);
app.post("/chat/completions", chatCompletions);
app.get("/v1/models", models);
app.get("/models", models);

// Anthropic-compatible
app.post("/v1/messages", messages);

Deno.serve(app.fetch);
