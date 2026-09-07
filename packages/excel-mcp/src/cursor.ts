import {
  decodeCursorPayload,
  isFresh,
  type Cursor,
  type Fingerprint,
} from "@sk-mcp/file-core";
import { SkMcpExcelError } from "./errors.js";

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
}

export type SheetCursor = Cursor<SheetPosition>;

function isSheetCursor(candidate: unknown): candidate is SheetCursor {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }
  const value = candidate as Record<string, unknown>;
  return (
    value["v"] === 1 &&
    typeof value["f"] === "string" &&
    typeof value["s"] === "string" &&
    typeof value["r"] === "number" &&
    typeof value["c"] === "number" &&
    typeof value["e"] === "string" &&
    (value["m"] === "values" ||
      value["m"] === "formulas" ||
      value["m"] === "both") &&
    (value["g"] === "master" || value["g"] === "repeat") &&
    typeof value["h"] === "number"
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
