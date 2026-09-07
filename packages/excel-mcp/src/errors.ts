import { sep } from "node:path";

export type SkMcpExcelErrorCode =
  | "invalid_argument"
  | "path_outside_root"
  | "unsupported_extension"
  | "file_not_found"
  | "not_a_file"
  | "file_too_large"
  | "encrypted_workbook"
  | "corrupt_workbook"
  | "undecodable_text"
  | "ambiguous_delimiter"
  | "unsupported_for_format"
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
  | "range_outside_used_range"
  | "invalid_cursor"
  | "stale_cursor"
  | "internal_error";

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

export interface ErrorContext {
  readonly root?: string;
  readonly tool?: string;
}

function withoutRoot(detail: string, root: string | undefined): string {
  if (root === undefined || root === "") {
    return detail;
  }
  return detail.split(`${root}${sep}`).join("").split(root).join(".");
}

export function asExcelError(
  error: unknown,
  context: ErrorContext = {},
): SkMcpExcelError {
  if (error instanceof SkMcpExcelError) {
    return error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  const subject = context.tool ?? "The tool";
  return new SkMcpExcelError(
    "internal_error",
    `${subject} failed unexpectedly: ${withoutRoot(detail, context.root)}`,
    "This is a fault in the excel-mcp server, not in the workbook. Retrying the same call will not help.",
  );
}
