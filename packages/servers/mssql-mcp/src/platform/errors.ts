import {
  baseSecretPatterns,
  DbSourceError,
  internalErrorMessage,
  internalErrorRecovery,
  McpSourceError,
  redactSecrets,
  type DbErrorCode,
  type ErrorContext,
  type ErrorFactory,
} from "@sk-mcp/db-core";
import { vocabulary } from "./vocabulary.js";

export type SkMcpMssqlErrorCode = DbErrorCode;

export class SkMcpMssqlError extends DbSourceError {
  declare readonly code: SkMcpMssqlErrorCode;
}

/**
 * Guard: the patterns are applied when the error is constructed, not when the
 * envelope is rendered, so an error is redacted even on the paths that write it
 * to stderr instead of returning it. The ODBC keyword forms are engine-specific
 * and do not belong in db-core's base set.
 */
export const secretPatterns = [
  ...baseSecretPatterns,
  /((?:\bserver|\bdata\s+source|\baddr|\baddress|\bnetwork\s+address)\s*=\s*)[^;,\s]*/gi,
  /(\b(?:user\s+id|uid)\s*=\s*)[^;,\s]*/gi,
] as const;

export const redact = (detail: string): string =>
  redactSecrets(detail, secretPatterns);

export const fail: ErrorFactory<SkMcpMssqlErrorCode> = (
  code,
  message,
  recovery,
) => new SkMcpMssqlError(code, redact(message), recovery && redact(recovery));

export function asMssqlError(
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
