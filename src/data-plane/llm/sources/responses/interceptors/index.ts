import type { StreamExecuteResult } from "../../../shared/errors/result.ts";
import type { SourceInterceptor } from "../../run-interceptors.ts";
import type { SourceResponseStreamEvent } from "../events/to-sse.ts";

export const responsesSourceInterceptors =
  [] satisfies readonly SourceInterceptor<
    StreamExecuteResult<SourceResponseStreamEvent>
  >[];
