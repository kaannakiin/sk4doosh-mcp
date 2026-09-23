import {
  internalErrorMessage,
  internalErrorRecovery,
  McpSourceError,
  type ErrorContext,
  type ErrorFactory,
  type SourceErrorCode,
} from "@sk-mcp/mcp-core";
import { vocabulary } from "./vocabulary.js";

export type SkMcpLlmErrorCode =
  | SourceErrorCode
  | "backend_unavailable"
  | "backend_refused"
  | "outside_workspace"
  | "file_not_found"
  | "not_text"
  | "input_too_large"
  | "unparsable_output";

export class SkMcpLlmError extends McpSourceError {
  declare readonly code: SkMcpLlmErrorCode;
}

export const fail: ErrorFactory<SkMcpLlmErrorCode> = (
  code,
  message,
  recovery,
) => new SkMcpLlmError(code, message, recovery);

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
