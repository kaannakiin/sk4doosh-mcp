import { createHash } from "node:crypto";
import { SkMcpExcelError } from "./errors.js";

export type ValueMode = "values" | "formulas" | "both";
export type MergePolicy = "master" | "repeat";

export interface SheetCursor {
  readonly v: 1;
  readonly f: string;
  readonly s: string;
  readonly r: number;
  readonly c: number;
  readonly e: string;
  readonly m: ValueMode;
  readonly g: MergePolicy;
  readonly h: number;
}

export function fingerprint(
  realPath: string,
  mtimeMs: number,
  size: number,
): string {
  return createHash("sha256")
    .update(`${realPath}:${mtimeMs}:${size}`)
    .digest("hex")
    .slice(0, 16);
}

export function encodeCursor(cursor: SheetCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

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

const invalidCursor = () =>
  new SkMcpExcelError(
    "invalid_cursor",
    "The cursor is not a token produced by a previous read_sheet response.",
    "Call read_sheet again without a cursor.",
  );

export function decodeCursor(raw: string): SheetCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw invalidCursor();
  }
  if (!isSheetCursor(parsed)) {
    throw invalidCursor();
  }
  return parsed;
}

export function assertFresh(cursor: SheetCursor, current: string): void {
  if (cursor.f !== current) {
    throw new SkMcpExcelError(
      "stale_cursor",
      "The workbook changed while the previous page was being read.",
      "Restart from read_sheet without a cursor.",
    );
  }
}
