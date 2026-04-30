import type { ResponsesPayload } from "../../../../../lib/responses-types.ts";
import { fixApplyPatchTools } from "./fix-apply-patch-tools.ts";
import { stripUnsupportedResponsesTools } from "./strip-unsupported-tools.ts";

export const normalizeResponsesRequest = (
  payload: ResponsesPayload,
): ResponsesPayload => {
  stripUnsupportedResponsesTools(payload);
  fixApplyPatchTools(payload);
  return payload;
};
