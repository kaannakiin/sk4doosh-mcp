import type { Worksheet } from "exceljs";
import type { CellSnapshot } from "./cell-value.js";
import type { GridBounds } from "./range.js";
import {
  autoFilterRefOf,
  declaredTablesOf,
  type DeclaredTable,
} from "./tables.js";
import { usedBounds } from "./workbook.js";

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

export function xlsxSheetView(worksheet: Worksheet): SheetView {
  return {
    name: worksheet.name,
    bounds: usedBounds(worksheet),
    merges: worksheet.model.merges,
    tables: declaredTablesOf(worksheet),
    autoFilter: autoFilterRefOf(worksheet),
    rowAt(row) {
      const found = worksheet.findRow(row);
      if (found === undefined) {
        return undefined;
      }
      return {
        cellAt(column) {
          const cell = found.findCell(column);
          if (cell === undefined) {
            return undefined;
          }
          return {
            type: cell.type,
            value: cell.value,
            formula: cell.formula,
            result: cell.result,
            numberFormat: cell.numFmt,
          };
        },
      };
    },
  };
}
