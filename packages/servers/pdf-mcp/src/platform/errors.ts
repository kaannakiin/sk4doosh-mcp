import {
  FileSourceError,
  internalErrorMessage,
  internalErrorRecovery,
  type CoreErrorCode,
  type ErrorContext,
  type ErrorFactory,
} from "@liaiso/file-core";
import { vocabulary } from "./vocabulary.js";

export type LiaisoPdfErrorCode =
  | CoreErrorCode
  | "malformed_pdf"
  | "encrypted_pdf"
  | "extraction_failed"
  | "ocr_unavailable"
  | "ocr_failed";

export class LiaisoPdfError extends FileSourceError {
  declare readonly code: LiaisoPdfErrorCode;

  constructor(code: LiaisoPdfErrorCode, message: string, recovery?: string) {
    super(code, message, recovery);
  }
}

export const fail: ErrorFactory<LiaisoPdfErrorCode> = (
  code,
  message,
  recovery,
) => new LiaisoPdfError(code, message, recovery);

export function asPdfError(
  error: unknown,
  context: ErrorContext = {},
): LiaisoPdfError {
  if (error instanceof LiaisoPdfError) {
    return error;
  }
  return new LiaisoPdfError(
    "internal_error",
    internalErrorMessage(error, context),
    internalErrorRecovery(vocabulary),
  );
}
