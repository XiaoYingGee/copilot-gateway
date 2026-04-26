import type { ResponseStreamEvent } from "../../../../../lib/responses-types.ts";
import type { ProtocolTerminalAlgebra } from "../../../shared/stream/protocol-algebra.ts";
import { isResponsesTerminalEvent } from "../../../shared/stream/terminal-events.ts";

export type SourceResponseStreamEvent = ResponseStreamEvent & {
  sequence_number?: number;
};

export const responsesSourceStreamAlgebra = {
  isTerminalEvent: isResponsesTerminalEvent,
  missingTerminalMessage: "Responses stream ended without a terminal event.",
} satisfies ProtocolTerminalAlgebra<SourceResponseStreamEvent>;
