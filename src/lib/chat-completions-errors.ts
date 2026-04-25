import { isRecord } from "./type-guards.ts";

export const chatCompletionsErrorPayloadMessage = (
  value: unknown,
): string | null => {
  if (!isRecord(value) || !isRecord(value.error)) return null;

  const type = typeof value.error.type === "string" ? value.error.type : null;
  const message = typeof value.error.message === "string"
    ? value.error.message
    : JSON.stringify(value.error);

  return `${type ? `${type}: ` : ""}${message}`;
};
