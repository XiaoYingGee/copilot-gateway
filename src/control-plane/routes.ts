import { Hono } from "hono";
import { adminOnlyMiddleware } from "../middleware/auth.ts";
import {
  createKey,
  deleteKey,
  listKeys,
  renameKey,
  rotateKey,
} from "./api-keys/routes.ts";
import {
  authGithub,
  authGithubDisconnect,
  authGithubOrder,
  authGithubPoll,
  authLogin,
  authLogout,
  authMe,
} from "./auth/routes.ts";
import { copilotQuota } from "./copilot-quota/routes.ts";
import { exportData, importData } from "./data-transfer/routes.ts";
import { mountPageRoutes } from "./pages/routes.ts";
import {
  getSearchConfigRoute,
  putSearchConfigRoute,
  testSearchConfigRoute,
} from "./search-config/routes.ts";
import { searchUsage } from "./search-usage/routes.ts";
import { tokenUsage } from "./token-usage/routes.ts";
import {
  performanceOverview,
  performanceTelemetry,
} from "./performance/routes.ts";
import { models } from "../data-plane/models/serve.ts";

export const mountControlPlane = (app: Hono) => {
  mountPageRoutes(app);

  app.post("/auth/login", authLogin);
  app.post("/auth/logout", authLogout);

  const adminAuth = new Hono();
  adminAuth.use("*", adminOnlyMiddleware);
  adminAuth.get("/github", authGithub);
  adminAuth.post("/github/poll", authGithubPoll);
  adminAuth.delete("/github/:id", authGithubDisconnect);
  adminAuth.post("/github/order", authGithubOrder);
  adminAuth.get("/me", authMe);
  app.route("/auth", adminAuth);

  app.get("/api/keys", listKeys);
  app.get("/api/token-usage", tokenUsage);
  app.get("/api/search-usage", searchUsage);
  app.get("/api/performance", performanceTelemetry);
  app.get("/api/performance/overview", performanceOverview);
  app.get("/api/models", models);

  const adminApi = new Hono();
  adminApi.use("*", adminOnlyMiddleware);
  adminApi.get("/copilot-quota", copilotQuota);
  adminApi.post("/keys", createKey);
  adminApi.post("/keys/:id/rotate", rotateKey);
  adminApi.patch("/keys/:id", renameKey);
  adminApi.delete("/keys/:id", deleteKey);
  adminApi.get("/search-config", getSearchConfigRoute);
  adminApi.put("/search-config", putSearchConfigRoute);
  adminApi.post("/search-config/test", testSearchConfigRoute);
  adminApi.get("/export", exportData);
  adminApi.post("/import", importData);
  app.route("/api", adminApi);
};
