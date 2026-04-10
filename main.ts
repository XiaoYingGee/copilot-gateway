import { initEnv } from "./src/lib/env.ts";
import { initRepo } from "./src/repo/mod.ts";
import { DenoKvRepo } from "./src/repo/deno.ts";
import { app } from "./src/app.ts";

initEnv((n) => Deno.env.get(n) ?? "");
initRepo(new DenoKvRepo(await Deno.openKv()));
Deno.serve({ port: Number(Deno.env.get("PORT")) || 8000 }, app.fetch);
