import {
  FileSourceError,
  internalErrorMessage,
  internalErrorRecovery,
  type CoreErrorCode,
  type ErrorContext,
  type ErrorFactory,
} from "@sk-mcp/file-core";
import { vocabulary } from "./vocabulary.js";

export type SkMcpXmlErrorCode =
  | CoreErrorCode
  | "malformed_xml"
  | "doctype_not_allowed"
  | "unsupported_encoding";

export class SkMcpXmlError extends FileSourceError {
  declare readonly code: SkMcpXmlErrorCode;

  constructor(code: SkMcpXmlErrorCode, message: string, recovery?: string) {
    super(code, message, recovery);
  }
}

export const fail: ErrorFactory<SkMcpXmlErrorCode> = (
  code,
  message,
  recovery,
) => new SkMcpXmlError(code, message, recovery);

export function asXmlError(
  error: unknown,
  context: ErrorContext = {},
): SkMcpXmlError {
  if (error instanceof SkMcpXmlError) {
    return error;
  }
  return new SkMcpXmlError(
    "internal_error",
    internalErrorMessage(error, context),
    internalErrorRecovery(vocabulary),
  );
}
