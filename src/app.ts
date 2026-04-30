import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { mountControlPlane } from "./control-plane/routes.ts";
import { mountDataPlane } from "./data-plane/routes.ts";
import { authMiddleware } from "./middleware/auth.ts";
import { performanceMiddleware } from "./middleware/performance.ts";
import { usageMiddleware } from "./middleware/usage.ts";

export const app = new Hono();

app.use("*", logger());
app.use("*", cors());
app.use("*", authMiddleware);
app.use("*", performanceMiddleware);
// Usage is inside performance so request_total is recorded after usage
// accounting and stream transforms have either completed or failed.
app.use("*", usageMiddleware);

mountControlPlane(app);
mountDataPlane(app);
