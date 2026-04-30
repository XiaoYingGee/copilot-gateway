import type { Context } from "hono";

export type BackgroundScheduler = (promise: Promise<unknown>) => void;

export function backgroundSchedulerFromContext(
  c: Context,
): BackgroundScheduler | undefined {
  try {
    const executionCtx = c.executionCtx;
    return (promise) => executionCtx.waitUntil(promise);
  } catch {
    return undefined;
  }
}

export function scheduleBackground(
  scheduler: BackgroundScheduler | undefined,
  promise: Promise<unknown>,
): void {
  if (scheduler) {
    scheduler(promise);
    return;
  }
  void promise;
}
