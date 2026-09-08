import {
  decodeCursorPayload,
  isFresh,
  type Cursor,
  type Fingerprint,
} from "@sk-mcp/file-core";
import { SkMcpExcelError } from "./errors.js";
import type { CsvOptions } from "./csv.js";

export { encodeCursor, fingerprint } from "@sk-mcp/file-core";
export type { Fingerprint } from "@sk-mcp/file-core";

export type ValueMode = "values" | "formulas" | "both";
export type MergePolicy = "master" | "repeat";

export interface SheetPosition {
  readonly s: string;
  readonly r: number;
  readonly c: number;
  readonly e: string;
  readonly m: ValueMode;
  readonly g: MergePolicy;
  readonly h: number;
  readonly o: CursorOptions;
}

export interface CursorOptions extends CsvOptions {
  readonly valueMode: ValueMode;
  readonly mergedCells: MergePolicy;
  readonly headerRow: number;
  readonly headerScan: boolean;
  readonly includeHyperlinks: boolean;
}

function isOptions(value: unknown): value is CursorOptions {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.valueMode === "values" ||
      v.valueMode === "formulas" ||
      v.valueMode === "both") &&
    (v.mergedCells === "master" || v.mergedCells === "repeat") &&
    typeof v.headerRow === "number" &&
    Number.isSafeInteger(v.headerRow) &&
    v.headerRow >= 0 &&
    v.headerRow <= 1048576 &&
    typeof v.headerScan === "boolean" &&
    typeof v.includeHyperlinks === "boolean" &&
    (v.delimiter === undefined ||
      ["comma", "semicolon", "tab", "pipe"].includes(String(v.delimiter))) &&
    (v.encoding === undefined ||
      [
        "utf-8",
        "utf-16le",
        "utf-16be",
        "windows-1254",
        "iso-8859-9",
        "windows-1252",
      ].includes(String(v.encoding)))
  );
}

export function inheritCursorOptions<
  T extends Partial<CursorOptions> & {
    readonly cursor?: string;
    readonly sheetName?: string;
    readonly range?: string;
  },
>(args: T): T & Partial<CursorOptions> {
  if (args.cursor === undefined) return args;
  if (args.sheetName !== undefined || args.range !== undefined)
    throw new SkMcpExcelError(
      "invalid_argument",
      "cursor cannot be combined with sheetName or range.",
    );
  const cursor = decodeCursor(args.cursor);
  for (const key of [
    "valueMode",
    "mergedCells",
    "headerRow",
    "headerScan",
    "includeHyperlinks",
    "delimiter",
    "encoding",
  ] as const) {
    if (args[key] !== undefined && args[key] !== cursor.o[key])
      throw new SkMcpExcelError(
        "invalid_argument",
        `Option '${key}' conflicts with the cursor.`,
        "Drop cursor to start a read with different options.",
      );
  }
  return { ...args, ...cursor.o };
}

export type SheetCursor = Cursor<SheetPosition, 2>;

function isSheetCursor(candidate: unknown): candidate is SheetCursor {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }
  const value = candidate as Record<string, unknown>;
  return (
    value["v"] === 2 &&
    typeof value["f"] === "string" &&
    /^[a-f0-9]{16,64}$/.test(value["f"]) &&
    typeof value["s"] === "string" &&
    typeof value["r"] === "number" &&
    Number.isSafeInteger(value["r"]) &&
    value["r"] >= 1 &&
    value["r"] <= 1048576 &&
    typeof value["c"] === "number" &&
    Number.isSafeInteger(value["c"]) &&
    value["c"] >= 1 &&
    value["c"] <= 16384 &&
    typeof value["e"] === "string" &&
    (value["m"] === "values" ||
      value["m"] === "formulas" ||
      value["m"] === "both") &&
    (value["g"] === "master" || value["g"] === "repeat") &&
    isOptions(value["o"]) &&
    value["h"] === value["o"].headerRow &&
    value["m"] === value["o"].valueMode &&
    value["g"] === value["o"].mergedCells
  );
}

export function decodeCursor(raw: string): SheetCursor {
  const parsed = decodeCursorPayload(raw);
  if (!isSheetCursor(parsed)) {
    throw new SkMcpExcelError(
      "invalid_cursor",
      "The cursor is not a token produced by a previous read_sheet response.",
      "Call read_sheet again without a cursor.",
    );
  }
  return parsed;
}

export function assertFresh(cursor: SheetCursor, current: Fingerprint): void {
  if (!isFresh(cursor, current)) {
    throw new SkMcpExcelError(
      "stale_cursor",
      "The workbook changed while the previous page was being read.",
      "Restart from read_sheet without a cursor.",
    );
  }
}
