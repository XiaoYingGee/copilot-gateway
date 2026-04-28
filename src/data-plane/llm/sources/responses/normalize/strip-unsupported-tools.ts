import type { ResponsesPayload } from "../../../../../lib/responses-types.ts";

const UNSUPPORTED_RESPONSES_TOOL_TYPES = new Set(["image_generation"]);

const isUnsupportedResponsesToolType = (type: unknown): type is string =>
  typeof type === "string" && UNSUPPORTED_RESPONSES_TOOL_TYPES.has(type);

const stripUnsupportedResponsesToolChoice = (
  payload: ResponsesPayload,
  removedUnsupportedTool: boolean,
): void => {
  const choice = payload.tool_choice as unknown;

  if (
    choice && typeof choice === "object" &&
    isUnsupportedResponsesToolType((choice as { type?: unknown }).type)
  ) {
    delete payload.tool_choice;
    return;
  }

  if (
    removedUnsupportedTool && choice === "required" &&
    (!Array.isArray(payload.tools) || payload.tools.length === 0)
  ) {
    delete payload.tool_choice;
  }
};

/**
 * Public Responses exposes hosted `image_generation`, but Copilot's Responses
 * upstream does not support that server-side tool or its forced `tool_choice`.
 * Strip both at source normalize so native `/responses` and translated
 * fallback paths share the same cleaned request before planning.
 *
 * References:
 * - https://platform.openai.com/docs/guides/tools-image-generation
 * - https://github.com/caozhiyuan/copilot-api/blob/1d21b4aca31f89ad49a0c3bf1a71e3561d445855/src/routes/responses/handler.ts#L167-L184
 */
export const stripUnsupportedResponsesTools = (
  payload: ResponsesPayload,
): void => {
  let removedUnsupportedTool = false;

  if (Array.isArray(payload.tools)) {
    const tools = payload.tools.filter((tool) => {
      const type = (tool as unknown as { type?: unknown }).type;
      const unsupported = isUnsupportedResponsesToolType(type);
      removedUnsupportedTool ||= unsupported;
      return !unsupported;
    });

    if (tools.length === 0) {
      delete payload.tools;
    } else {
      payload.tools = tools;
    }
  }

  stripUnsupportedResponsesToolChoice(payload, removedUnsupportedTool);
};
