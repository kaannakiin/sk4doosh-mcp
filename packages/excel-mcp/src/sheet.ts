import type { Worksheet } from "exceljs";
import type { CellSnapshot } from "./cell-value.js";
import type { GridBounds } from "./range.js";
import { usedBounds } from "./workbook.js";

export interface RowView {
  cellAt(column: number): CellSnapshot | undefined;
}

export interface DeclaredTable {
  readonly name: string;
  readonly ref: string;
  readonly headerRow: boolean;
  readonly columns: readonly string[];
}

export interface SheetView {
  readonly name: string;
  readonly bounds: GridBounds | undefined;
  readonly merges: readonly string[];
  readonly tables: readonly DeclaredTable[];
  readonly autoFilter: string | undefined;
  rowAt(row: number): RowView | undefined;
}

interface TableReader {
  readonly tables?: Readonly<
    Record<
      string,
      {
        table?: {
          name?: string;
          tableRef?: string;
          headerRow?: boolean;
          columns?: readonly { name?: string }[];
        };
      }
    >
  >;
  readonly autoFilter?: unknown;
}

function declaredTablesOf(worksheet: Worksheet): DeclaredTable[] {
  const stored = (worksheet as Worksheet & TableReader).tables;
  if (stored === undefined) {
    return [];
  }
  const declared: DeclaredTable[] = [];
  for (const [key, entry] of Object.entries(stored)) {
    const table = entry.table;
    const ref = table?.tableRef;
    if (ref === undefined) {
      continue;
    }
    declared.push({
      name: table?.name ?? key,
      ref,
      headerRow: table?.headerRow !== false,
      columns: (table?.columns ?? [])
        .map((column) => column.name)
        .filter((name): name is string => typeof name === "string"),
    });
  }
  return declared;
}

function autoFilterOf(worksheet: Worksheet): string | undefined {
  const filter = (worksheet as Worksheet & TableReader).autoFilter;
  return typeof filter === "string" ? filter : undefined;
}

export function xlsxSheetView(worksheet: Worksheet): SheetView {
  return {
    name: worksheet.name,
    bounds: usedBounds(worksheet),
    merges: worksheet.model.merges,
    tables: declaredTablesOf(worksheet),
    autoFilter: autoFilterOf(worksheet),
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
