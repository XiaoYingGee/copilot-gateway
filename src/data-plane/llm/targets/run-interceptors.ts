import type { RawEmitResult } from "./emit-types.ts";

export type TargetRun<TJson> = () => Promise<RawEmitResult<TJson>>;

export type TargetInterceptor<TContext, TJson> = (
  ctx: TContext,
  run: TargetRun<TJson>,
) => Promise<RawEmitResult<TJson>>;

export const runTargetInterceptors = async <TContext, TJson>(
  ctx: TContext,
  interceptors: readonly TargetInterceptor<TContext, TJson>[],
  attempt: TargetRun<TJson>,
): Promise<RawEmitResult<TJson>> => {
  const run = (index: number): Promise<RawEmitResult<TJson>> =>
    index < interceptors.length
      ? interceptors[index](ctx, () => run(index + 1))
      : attempt();

  return await run(0);
};
