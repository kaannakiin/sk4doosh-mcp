import {
  FileSourceError,
  internalErrorMessage,
  internalErrorRecovery,
  type CoreErrorCode,
  type ErrorContext,
  type ErrorFactory,
} from "@sk-mcp/file-core";
import { vocabulary } from "./vocabulary.js";

export type SkMcpExcelErrorCode =
  | CoreErrorCode
  | "encrypted_workbook"
  | "corrupt_workbook"
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

export class SkMcpExcelError extends FileSourceError {
  declare readonly code: SkMcpExcelErrorCode;

  constructor(code: SkMcpExcelErrorCode, message: string, recovery?: string) {
    super(code, message, recovery);
  }
}

export const fail: ErrorFactory<SkMcpExcelErrorCode> = (
  code,
  message,
  recovery,
) => new SkMcpExcelError(code, message, recovery);

export function asExcelError(
  error: unknown,
  context: ErrorContext = {},
): SkMcpExcelError {
  if (error instanceof SkMcpExcelError) {
    return error;
  }
  return new SkMcpExcelError(
    "internal_error",
    internalErrorMessage(error, context),
    internalErrorRecovery(vocabulary),
  );
}
