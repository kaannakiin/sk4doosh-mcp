export type SkMcpExcelErrorCode =
  | "invalid_argument"
  | "path_outside_root"
  | "unsupported_extension"
  | "file_not_found"
  | "not_a_file"
  | "file_too_large"
  | "legacy_xls_format"
  | "encrypted_workbook"
  | "corrupt_workbook"
  | "undecodable_text"
  | "ambiguous_delimiter"
  | "unsupported_for_format"
  | "unknown_column"
  | "ambiguous_column"
  | "unknown_sheet"
  | "ambiguous_sheet"
  | "empty_sheet"
  | "invalid_range"
  | "invalid_pattern"
  | "range_outside_used_range"
  | "invalid_cursor"
  | "stale_cursor";

export class SkMcpExcelError extends Error {
  constructor(
    readonly code: SkMcpExcelErrorCode,
    message: string,
    readonly recovery?: string,
  ) {
    super(message);
    this.name = "SkMcpExcelError";
  }
}

export function asExcelError(error: unknown): SkMcpExcelError {
  if (error instanceof SkMcpExcelError) {
    return error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new SkMcpExcelError(
    "corrupt_workbook",
    `The workbook could not be read: ${detail}`,
    "Open the file in Excel and re-save it as .xlsx.",
  );
}
