import {
  FileSourceError,
  internalErrorMessage,
  internalErrorRecovery,
  type CoreErrorCode,
  type ErrorContext,
  type ErrorFactory,
} from "@liaiso/file-core";
import { vocabulary } from "./vocabulary.js";

export type LiaisoExcelErrorCode =
  | CoreErrorCode
  | "encrypted_workbook"
  | "corrupt_workbook"
  | "not_a_workbook"
  | "undecodable_text"
  | "ambiguous_delimiter"
  | "unsupported_object_kind"
  | "unknown_column"
  | "ambiguous_column"
  | "unknown_sheet"
  | "ambiguous_sheet"
  | "empty_sheet"
  | "unknown_header_row"
  | "ambiguous_header_row"
  | "invalid_range"
  | "invalid_pattern"
  | "numeric_overflow"
  | "range_outside_used_range";

export class LiaisoExcelError extends FileSourceError {
  declare readonly code: LiaisoExcelErrorCode;

  constructor(code: LiaisoExcelErrorCode, message: string, recovery?: string) {
    super(code, message, recovery);
  }
}

export const fail: ErrorFactory<LiaisoExcelErrorCode> = (
  code,
  message,
  recovery,
) => new LiaisoExcelError(code, message, recovery);

export function asExcelError(
  error: unknown,
  context: ErrorContext = {},
): LiaisoExcelError {
  if (error instanceof LiaisoExcelError) {
    return error;
  }
  return new LiaisoExcelError(
    "internal_error",
    internalErrorMessage(error, context),
    internalErrorRecovery(vocabulary),
  );
}
