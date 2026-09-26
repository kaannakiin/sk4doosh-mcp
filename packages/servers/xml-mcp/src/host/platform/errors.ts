import {
  FileSourceError,
  internalErrorMessage,
  internalErrorRecovery,
  type CoreErrorCode,
  type ErrorContext,
  type ErrorFactory,
} from "@liaiso/file-core";
import { vocabulary } from "./vocabulary.js";

export type LiaisoXmlErrorCode =
  | CoreErrorCode
  | "malformed_xml"
  | "doctype_not_allowed"
  | "unsupported_encoding"
  | "query_not_supported"
  | "numeric_precision";

export class LiaisoXmlError extends FileSourceError {
  declare readonly code: LiaisoXmlErrorCode;

  constructor(code: LiaisoXmlErrorCode, message: string, recovery?: string) {
    super(code, message, recovery);
  }
}

export const fail: ErrorFactory<LiaisoXmlErrorCode> = (
  code,
  message,
  recovery,
) => new LiaisoXmlError(code, message, recovery);

export function asXmlError(
  error: unknown,
  context: ErrorContext = {},
): LiaisoXmlError {
  if (error instanceof LiaisoXmlError) {
    return error;
  }
  return new LiaisoXmlError(
    "internal_error",
    internalErrorMessage(error, context),
    internalErrorRecovery(vocabulary),
  );
}
