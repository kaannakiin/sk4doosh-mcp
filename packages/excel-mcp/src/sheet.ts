import type { Fingerprint } from "@sk-mcp/file-core";
import type { CellSnapshot } from "./cell-value.js";
import { SkMcpExcelError } from "./errors.js";
import type { GridBounds } from "./range.js";

export interface DeclaredTable {
  readonly name: string;
  readonly ref: string;
  readonly headerRow: boolean;
  readonly columns: readonly string[];
}

export interface RowView {
  cellAt(column: number): CellSnapshot | undefined;
}

export interface SheetView {
  readonly name: string;
  readonly bounds: GridBounds | undefined;
  readonly merges: readonly string[];
  readonly tables: readonly DeclaredTable[];
  readonly autoFilter: string | undefined;
  rowAt(row: number): RowView | undefined;
}

export interface SheetSource {
  readonly stamp: Fingerprint;
  sheetFor(sheetName: string | undefined): SheetView;
}

export interface BoundedSheet {
  readonly name: string;
  readonly bounds: GridBounds | undefined;
}

export function requireSheetBounds(sheet: BoundedSheet): GridBounds {
  if (sheet.bounds === undefined) {
    throw new SkMcpExcelError(
      "empty_sheet",
      `Sheet '${sheet.name}' has no cells with values.`,
      "Call describe_workbook to see which sheets carry data.",
    );
  }
  return sheet.bounds;
}
