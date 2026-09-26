import {
  internalErrorMessage,
  internalErrorRecovery,
  McpSourceError,
  type ErrorContext,
  type ErrorFactory,
  type SourceErrorCode,
} from "@liaiso/mcp-core";
import { vocabulary } from "./vocabulary.js";

export type LiaisoLlmErrorCode =
  | SourceErrorCode
  | "backend_unavailable"
  | "backend_refused"
  | "outside_workspace"
  | "file_not_found"
  | "not_text"
  | "input_too_large"
  | "unparsable_output";

export class LiaisoLlmError extends McpSourceError {
  declare readonly code: LiaisoLlmErrorCode;
}

export const fail: ErrorFactory<LiaisoLlmErrorCode> = (
  code,
  message,
  recovery,
) => new LiaisoLlmError(code, message, recovery);

export function asLlmError(
  error: unknown,
  context: ErrorContext = {},
): McpSourceError {
  if (error instanceof McpSourceError) {
    return error;
  }
  return fail(
    "internal_error",
    internalErrorMessage(error, context),
    internalErrorRecovery(vocabulary),
  );
}
