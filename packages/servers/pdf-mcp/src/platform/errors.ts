import {
  FileSourceError,
  internalErrorMessage,
  internalErrorRecovery,
  type CoreErrorCode,
  type ErrorContext,
  type ErrorFactory,
} from "@sk-mcp/file-core";
import { vocabulary } from "./vocabulary.js";

export type SkMcpPdfErrorCode =
  | CoreErrorCode
  | "malformed_pdf"
  | "encrypted_pdf"
  | "extraction_failed"
  | "ocr_unavailable"
  | "ocr_failed";

export class SkMcpPdfError extends FileSourceError {
  declare readonly code: SkMcpPdfErrorCode;

  constructor(code: SkMcpPdfErrorCode, message: string, recovery?: string) {
    super(code, message, recovery);
  }
}

export const fail: ErrorFactory<SkMcpPdfErrorCode> = (
  code,
  message,
  recovery,
) => new SkMcpPdfError(code, message, recovery);

export function asPdfError(
  error: unknown,
  context: ErrorContext = {},
): SkMcpPdfError {
  if (error instanceof SkMcpPdfError) {
    return error;
  }
  return new SkMcpPdfError(
    "internal_error",
    internalErrorMessage(error, context),
    internalErrorRecovery(vocabulary),
  );
}
