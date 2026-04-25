import type { CopilotFetchOptions } from "../../../lib/copilot.ts";
import type { ExecuteResult } from "../shared/errors/result.ts";
import type { ProtocolFrame, StreamFrame } from "../shared/stream/types.ts";
import type { SourceApi } from "../shared/types/source-api.ts";

export interface EmitInput<TPayload> {
  sourceApi: SourceApi;
  payload: TPayload;
  githubToken: string;
  accountType: string;
  apiKeyId?: string;
  fetchOptions?: CopilotFetchOptions;
}

export type RawEmitResult<TJson> = ExecuteResult<StreamFrame<TJson>>;

export type EmitResult<TEvent> = ExecuteResult<ProtocolFrame<TEvent>>;
