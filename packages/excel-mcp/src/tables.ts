import type { Worksheet } from "exceljs";
import { limits } from "./limits.js";
import { columnToLetters, parseCellRef } from "./range.js";
import type { DeclaredTable } from "./sheet.js";

export interface TableColumnDetail {
  readonly name: string;
  readonly letter?: string;
  readonly totalsRowFunction?: string;
  readonly totalsRowLabel?: string;
  readonly filterButton?: boolean;
}

export interface DeclaredTableDetail {
  readonly name: string;
  readonly displayName?: string;
  readonly ref: string;
  readonly headerRow: boolean;
  readonly totalsRow: boolean;
  readonly autoFilterRef?: string;
  readonly columns: readonly TableColumnDetail[];
  readonly columnsTruncated: boolean;
}

export interface TableReport {
  readonly sheet: string;
  readonly count: number;
  readonly tables: readonly DeclaredTableDetail[];
  readonly truncated: boolean;
  readonly truncationReason?: "maxTablesPerSheet";
  readonly hint?: string;
}

interface StoredTableColumn {
  readonly name?: string;
  readonly totalsRowFunction?: string;
  readonly totalsRowLabel?: string;
  readonly filterButton?: boolean;
}

interface StoredTable {
  readonly name?: string;
  readonly displayName?: string;
  readonly tableRef?: string;
  readonly headerRow?: boolean;
  readonly totalsRow?: boolean;
  readonly autoFilterRef?: string;
  readonly columns?: readonly StoredTableColumn[];
}

type RefTable = StoredTable & { readonly tableRef: string };

interface TableReader {
  readonly tables?: Readonly<Record<string, { table?: StoredTable }>>;
  readonly autoFilter?: unknown;
}

function storedTablesOf(
  worksheet: Worksheet,
): readonly (readonly [string, RefTable])[] {
  const stored = (worksheet as Worksheet & TableReader).tables;
  if (stored === undefined) {
    return [];
  }
  const found: [string, RefTable][] = [];
  for (const [key, entry] of Object.entries(stored)) {
    const table = entry.table;
    const ref = table?.tableRef;
    if (table === undefined || ref === undefined) {
      continue;
    }
    found.push([key, { ...table, tableRef: ref }]);
  }
  return found;
}

export function declaredTablesOf(worksheet: Worksheet): DeclaredTable[] {
  return storedTablesOf(worksheet).map(([key, table]) => ({
    name: table.name ?? key,
    ref: table.tableRef,
    headerRow: table.headerRow !== false,
    columns: (table.columns ?? [])
      .map((column) => column.name)
      .filter((name): name is string => typeof name === "string"),
  }));
}

export function autoFilterRefOf(worksheet: Worksheet): string | undefined {
  const filter = (worksheet as Worksheet & TableReader).autoFilter;
  return typeof filter === "string" ? filter : undefined;
}

export function tableCountOf(worksheet: Worksheet): number {
  return storedTablesOf(worksheet).length;
}

interface Origin {
  readonly row: number;
  readonly left: number;
  readonly right: number;
}

function originOf(ref: string): Origin | undefined {
  const [start, end] = ref.split(":");
  if (start === undefined) {
    return undefined;
  }
  const topLeft = parseCellRef(start);
  const bottomRight = end === undefined ? topLeft : parseCellRef(end);
  return {
    row: topLeft.row,
    left: topLeft.column,
    right: bottomRight.column,
  };
}

function columnDetail(
  column: StoredTableColumn,
  offset: number,
  origin: Origin | undefined,
  key: string,
  totalsRow: boolean,
): TableColumnDetail {
  const index = origin === undefined ? undefined : origin.left + offset;
  const letter =
    index === undefined || origin === undefined || index > origin.right
      ? undefined
      : columnToLetters(index);
  const totalsRowFunction =
    column.totalsRowFunction === undefined ||
    column.totalsRowFunction === "none"
      ? undefined
      : column.totalsRowFunction;
  return {
    name: column.name ?? key,
    ...(letter === undefined ? {} : { letter }),
    ...(totalsRowFunction === undefined ? {} : { totalsRowFunction }),
    ...(!totalsRow || column.totalsRowLabel === undefined
      ? {}
      : { totalsRowLabel: column.totalsRowLabel }),
    ...(column.filterButton === true ? { filterButton: true } : {}),
  };
}

function tableDetail(key: string, table: RefTable): DeclaredTableDetail {
  const ref = table.tableRef;
  const origin = originOf(ref);
  const name = table.name ?? key;
  const totalsRow = table.totalsRow === true;
  const declared = table.columns ?? [];
  const columnsTruncated = declared.length > limits.maxTableColumns;
  const kept = columnsTruncated
    ? declared.slice(0, limits.maxTableColumns)
    : declared;
  return {
    name,
    ...(table.displayName === undefined || table.displayName === name
      ? {}
      : { displayName: table.displayName }),
    ref,
    headerRow: table.headerRow !== false,
    totalsRow,
    ...(table.autoFilterRef === undefined
      ? {}
      : { autoFilterRef: table.autoFilterRef }),
    columns: kept.map((column, offset) =>
      columnDetail(column, offset, origin, `${name}${offset + 1}`, totalsRow),
    ),
    columnsTruncated,
  };
}

export function collectTables(worksheet: Worksheet): TableReport {
  const ordered = storedTablesOf(worksheet)
    .map(([key, table]) => ({ key, table, origin: originOf(table.tableRef) }))
    .sort((left, right) => {
      const a = left.origin;
      const b = right.origin;
      if (a === undefined || b === undefined) {
        return 0;
      }
      return a.row === b.row ? a.left - b.left : a.row - b.row;
    });
  const truncated = ordered.length > limits.maxTablesPerSheet;
  const kept = truncated ? ordered.slice(0, limits.maxTablesPerSheet) : ordered;
  return {
    sheet: worksheet.name,
    count: ordered.length,
    tables: kept.map((entry) => tableDetail(entry.key, entry.table)),
    truncated,
    ...(truncated
      ? {
          truncationReason: "maxTablesPerSheet" as const,
          hint: `${ordered.length} tables are declared on this sheet; the first ${limits.maxTablesPerSheet} are listed. Call describe_workbook for the count on every sheet.`,
        }
      : {}),
  };
}
