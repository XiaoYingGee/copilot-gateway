// copilot-deno — GitHub Copilot API proxy for Deno Deploy
//
// Exposes:
//   POST /v1/chat/completions   (OpenAI-compatible, passthrough)
//   POST /v1/messages           (Anthropic-compatible, translated)
//   POST /v1/embeddings         (OpenAI-compatible, passthrough)
//   POST /v1/responses          (OpenAI Responses API, passthrough)
//   GET  /v1/models
//   GET  /api/usage
//
// Frontend:
//   GET  /              — Login page (or JSON health check for API clients)
//   GET  /dashboard     — Usage dashboard
//
// Auth: ACCESS_KEY (admin) or per-key API keys via ?key=, x-api-key, or Authorization: Bearer
// Frontend auth: ACCESS_KEY stored in localStorage, sent as x-api-key header

import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { chatCompletions } from "./routes/chat-completions.ts";
import { models } from "./routes/models.ts";
import { messages } from "./routes/messages.ts";
import { embeddings } from "./routes/embeddings.ts";
import { copilotQuota } from "./routes/copilot-quota.ts";
import { responses } from "./routes/responses.ts";
import { countTokens } from "./routes/count-tokens.ts";
import {
  authLogin,
  authLogout,
  authGithub,
  authGithubPoll,
  authMe,
} from "./routes/auth.ts";
import { authMiddleware } from "./middleware/auth.ts";
import { usageMiddleware } from "./middleware/usage.ts";
import { LoginPage } from "./ui/login.tsx";
import { DashboardPage } from "./ui/dashboard.tsx";
import { listKeys, createKey, deleteKey, rotateKey } from "./routes/api-keys.ts";
import { tokenUsage } from "./routes/token-usage.ts";

const app = new Hono();

app.use("*", logger());
app.use("*", cors());
app.use("*", authMiddleware);
app.use("*", usageMiddleware);

// Frontend pages (public — auth handled client-side)
app.get("/", (c) => {
  const accept = c.req.header("accept") ?? "";
  if (accept.includes("application/json") && !accept.includes("text/html")) {
    return c.json({ status: "ok", service: "copilot-deno" });
  }
  return c.html(LoginPage());
});
app.get("/dashboard", (c) => c.html(DashboardPage()));

// Dashboard API
app.get("/api/usage", copilotQuota);
app.get("/api/token-usage", tokenUsage);
app.get("/api/keys", listKeys);
app.post("/api/keys", createKey);
app.post("/api/keys/:id/rotate", rotateKey);
app.delete("/api/keys/:id", deleteKey);

// OpenAI-compatible
app.post("/v1/chat/completions", chatCompletions);
app.post("/chat/completions", chatCompletions);
app.get("/v1/models", models);
app.get("/models", models);
app.post("/v1/embeddings", embeddings);
app.post("/embeddings", embeddings);
app.post("/v1/responses", responses);
app.post("/responses", responses);

// Anthropic-compatible
app.post("/v1/messages", messages);
app.post("/v1/messages/count_tokens", countTokens);

// Copilot quota (legacy path)
app.get("/usage", copilotQuota);

// Auth
app.post("/auth/login", authLogin);
app.post("/auth/logout", authLogout);
app.get("/auth/github", authGithub);
app.post("/auth/github/poll", authGithubPoll);
app.get("/auth/me", authMe);

Deno.serve(app.fetch);
