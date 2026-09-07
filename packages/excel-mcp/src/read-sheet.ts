import {
  normalizeCell,
  type CellNote,
  type CellScalar,
  type NormalizeOptions,
} from "./cell-value.js";
import {
  assertFresh,
  decodeCursor,
  encodeCursor,
  type MergePolicy,
  type ValueMode,
} from "./cursor.js";
import { documentSheet, type LoadedDocument } from "./document.js";
import { SkMcpExcelError } from "./errors.js";
import {
  headerWarnings,
  readHeaderRow,
  type HeaderRowSource,
} from "./header.js";
import { limits } from "./limits.js";
import {
  columnToLetters,
  formatCellRef,
  formatRange,
  parseCellRef,
  resolveRange,
  type GridBounds,
} from "./range.js";
import type { SheetView } from "./sheet.js";
import { canonical, fold } from "./unicode.js";
import { requireSheetBounds } from "./workbook.js";

export interface ColumnInfo {
  readonly letter: string;
  readonly index: number;
  readonly header: string | null;
  readonly numberFormat: string | null;
}

export interface ReadSheetOptions {
  readonly sheetName?: string;
  readonly range?: string;
  readonly cursor?: string;
  readonly maxCells: number;
  readonly valueMode: ValueMode;
  readonly mergedCells: MergePolicy;
  readonly headerRow: number;
  readonly headerRowSource: HeaderRowSource;
  readonly includeHyperlinks: boolean;
}

export interface ReadSheetResult {
  readonly sheet: string;
  readonly range: string;
  readonly usedRange: string;
  readonly headerRow: number;
  readonly headerRowSource: HeaderRowSource;
  readonly columns: readonly ColumnInfo[];
  readonly values: readonly (readonly CellScalar[])[];
  readonly cellNotes?: Readonly<Record<string, CellNote>>;
  readonly merges?: readonly string[];
  readonly returnedRows: number;
  readonly returnedCells: number;
  readonly truncated: boolean;
  readonly truncationReason?: "maxCells" | "maxPayloadBytes";
  readonly nextCursor?: string;
  readonly hint?: string;
  readonly warnings?: readonly string[];
}

interface Window {
  readonly sheet: SheetView;
  readonly used: GridBounds;
  readonly bounds: GridBounds;
  readonly startRow: number;
  readonly valueMode: ValueMode;
  readonly mergedCells: MergePolicy;
  readonly headerRow: number;
  readonly headerRowSource: HeaderRowSource;
}

function resolveWindow(
  loaded: LoadedDocument,
  options: ReadSheetOptions,
): Window {
  if (options.cursor === undefined) {
    const sheet = documentSheet(loaded, options.sheetName);
    const used = requireSheetBounds(sheet);
    const bounds = resolveRange(used, options.range);
    const headerRow = options.headerRow;
    const startRow =
      headerRow >= bounds.top && headerRow <= bounds.bottom
        ? Math.max(bounds.top, headerRow + 1)
        : bounds.top;
    return {
      sheet,
      used,
      bounds,
      startRow,
      valueMode: options.valueMode,
      mergedCells: options.mergedCells,
      headerRow,
      headerRowSource: options.headerRowSource,
    };
  }
  if (options.sheetName !== undefined || options.range !== undefined) {
    throw new SkMcpExcelError(
      "invalid_argument",
      "cursor cannot be combined with sheetName or range.",
      "Pass only the cursor to continue, or drop the cursor to start a new read.",
    );
  }
  const cursor = decodeCursor(options.cursor);
  assertFresh(cursor, loaded.stamp);
  const sheet = documentSheet(loaded, cursor.s);
  const used = requireSheetBounds(sheet);
  const end = parseCellRef(cursor.e);
  const bounds: GridBounds = {
    top: cursor.r,
    left: cursor.c,
    bottom: end.row,
    right: end.column,
  };
  if (bounds.bottom < bounds.top || bounds.right < bounds.left) {
    throw new SkMcpExcelError(
      "invalid_cursor",
      "The cursor points past the end of the range.",
    );
  }
  return {
    sheet,
    used,
    bounds,
    startRow: cursor.r,
    valueMode: cursor.m,
    mergedCells: cursor.g,
    headerRow: cursor.h,
    headerRowSource: "cursor",
  };
}

function overlaps(merge: string, bounds: GridBounds): boolean {
  const [start, end] = merge.split(":");
  if (start === undefined || end === undefined) {
    return false;
  }
  const topLeft = parseCellRef(start);
  const bottomRight = parseCellRef(end);
  return (
    topLeft.row <= bounds.bottom &&
    bottomRight.row >= bounds.top &&
    topLeft.column <= bounds.right &&
    bottomRight.column >= bounds.left
  );
}

export function readSheet(
  loaded: LoadedDocument,
  options: ReadSheetOptions,
): ReadSheetResult {
  const window = resolveWindow(loaded, options);
  const normalizeOptions: NormalizeOptions = {
    valueMode: window.valueMode,
    mergePolicy: window.mergedCells,
    includeHyperlinks: options.includeHyperlinks,
  };
  const width = window.bounds.right - window.bounds.left + 1;
  const headers = readHeaderRow(
    window.sheet,
    window.bounds,
    window.headerRow,
    normalizeOptions,
  );
  const numberFormats: (string | null)[] = new Array(width).fill(null);
  const values: CellScalar[][] = [];
  const cellNotes: Record<string, CellNote> = {};

  let returnedCells = 0;
  let payloadBytes = 0;
  let uncachedFormulas = 0;
  let truncationReason: "maxCells" | "maxPayloadBytes" | undefined;
  let nextRow = window.startRow;

  for (
    let rowNumber = window.startRow;
    rowNumber <= window.bounds.bottom;
    rowNumber += 1
  ) {
    if (values.length > 0 && returnedCells + width > options.maxCells) {
      truncationReason = "maxCells";
      break;
    }
    const row = window.sheet.rowAt(rowNumber);
    const line: CellScalar[] = [];
    for (
      let column = window.bounds.left;
      column <= window.bounds.right;
      column += 1
    ) {
      const snapshot = row?.cellAt(column);
      if (snapshot === undefined) {
        line.push(null);
        continue;
      }
      const offset = column - window.bounds.left;
      if (
        numberFormats[offset] === null &&
        typeof snapshot.numberFormat === "string"
      ) {
        numberFormats[offset] = snapshot.numberFormat;
      }
      const normalized = normalizeCell(snapshot, normalizeOptions);
      line.push(normalized.value);
      if (normalized.note !== undefined) {
        cellNotes[formatCellRef(rowNumber, column)] = normalized.note;
        if (normalized.note.kind === "formula" && !normalized.note.cached) {
          uncachedFormulas += 1;
        }
      }
    }
    const lineBytes = JSON.stringify(line).length;
    if (
      values.length > 0 &&
      payloadBytes + lineBytes > limits.maxPayloadBytes
    ) {
      truncationReason = "maxPayloadBytes";
      break;
    }
    values.push(line);
    payloadBytes += lineBytes;
    returnedCells += width;
    nextRow = rowNumber + 1;
  }

  const columns: ColumnInfo[] = [];
  for (let offset = 0; offset < width; offset += 1) {
    const index = window.bounds.left + offset;
    columns.push({
      letter: columnToLetters(index),
      index,
      header: headers[offset] ?? null,
      numberFormat: numberFormats[offset] ?? null,
    });
  }

  const truncated = truncationReason !== undefined;
  const merges = window.sheet.merges.filter((merge) =>
    overlaps(merge, window.bounds),
  );
  const remaining = window.bounds.bottom - nextRow + 1;

  const warnings: string[] = [];
  if (uncachedFormulas > 0) {
    warnings.push(
      `${uncachedFormulas} formula cells have no cached value; this workbook has not been recalculated by Excel.`,
    );
  }
  if (options.cursor === undefined) {
    warnings.push(
      ...headerWarnings(
        window.sheet,
        window.bounds,
        window.headerRow,
        headers,
        options.range !== undefined,
        window.mergedCells,
      ),
    );
  }

  return {
    sheet: window.sheet.name,
    range: formatRange({
      top: window.startRow,
      left: window.bounds.left,
      bottom: Math.max(window.startRow, nextRow - 1),
      right: window.bounds.right,
    }),
    usedRange: formatRange(window.used),
    headerRow: window.headerRow,
    headerRowSource: window.headerRowSource,
    columns,
    values,
    ...(Object.keys(cellNotes).length > 0 ? { cellNotes } : {}),
    ...(merges.length > 0 ? { merges } : {}),
    returnedRows: values.length,
    returnedCells,
    truncated,
    ...(truncationReason === undefined ? {} : { truncationReason }),
    ...(truncated
      ? {
          nextCursor: encodeCursor({
            v: 1,
            f: loaded.stamp,
            s: window.sheet.name,
            r: nextRow,
            c: window.bounds.left,
            e: formatCellRef(window.bounds.bottom, window.bounds.right),
            m: window.valueMode,
            g: window.mergedCells,
            h: window.headerRow,
          }),
          hint: `${remaining} rows remain. Prefer aggregate_sheet for totals, find_in_sheet to locate a value, or a narrower range over paging.`,
        }
      : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export interface FindOptions {
  readonly query: string;
  readonly sheetName?: string;
  readonly matchMode: "contains" | "exact" | "regex";
  readonly caseSensitive: boolean;
  readonly searchIn: "values" | "formulas" | "both";
  readonly range?: string;
  readonly maxResults: number;
}

export interface FindMatch {
  readonly address: string;
  readonly row: number;
  readonly column: number;
  readonly value: CellScalar;
}

export interface FindResult {
  readonly sheet: string;
  readonly range: string;
  readonly total: number;
  readonly truncated: boolean;
  readonly scannedCells: number;
  readonly matching: Matching;
  readonly matches: readonly FindMatch[];
}

export type Matching = "exact" | "canonical" | "folded" | "regex";

interface Matcher {
  readonly matching: Matching;
  readonly test: (text: string) => boolean;
}

function createRegexMatcher(options: FindOptions): Matcher {
  if (options.query.length > limits.maxRegexSource) {
    throw new SkMcpExcelError(
      "invalid_pattern",
      `The regular expression is longer than ${limits.maxRegexSource} characters.`,
      "Shorten the pattern or use matchMode 'contains'.",
    );
  }
  if (options.query.includes("\\p{") || options.query.includes("\\P{")) {
    throw new SkMcpExcelError(
      "invalid_pattern",
      "Unicode property escapes are not supported in regex patterns.",
      "Use matchMode 'contains', which folds case and diacritics.",
    );
  }
  let expression: RegExp;
  try {
    expression = new RegExp(options.query, options.caseSensitive ? "" : "i");
  } catch (error) {
    throw new SkMcpExcelError(
      "invalid_pattern",
      `The regular expression is not valid: ${error instanceof Error ? error.message : ""}`,
      "Use matchMode 'contains' for plain text search.",
    );
  }
  return {
    matching: "regex",
    test: (text) => expression.test(canonical(text)),
  };
}

function createMatcher(options: FindOptions): Matcher {
  if (options.matchMode === "regex") {
    return createRegexMatcher(options);
  }
  const prepare = options.caseSensitive ? canonical : fold;
  const matching: Matching = options.caseSensitive ? "canonical" : "folded";
  const needle = prepare(options.query);
  if (options.matchMode === "exact") {
    return { matching, test: (text) => prepare(text) === needle };
  }
  return { matching, test: (text) => prepare(text).includes(needle) };
}

export function findInSheet(
  loaded: LoadedDocument,
  options: FindOptions,
): FindResult {
  const sheet = documentSheet(loaded, options.sheetName);
  const used = requireSheetBounds(sheet);
  const bounds = resolveRange(used, options.range);
  const matcher = createMatcher(options);
  const normalizeOptions: NormalizeOptions = {
    valueMode: "values",
    mergePolicy: "master",
    includeHyperlinks: false,
  };
  const found: FindMatch[] = [];
  let total = 0;
  let scannedCells = 0;

  for (let rowNumber = bounds.top; rowNumber <= bounds.bottom; rowNumber += 1) {
    const row = sheet.rowAt(rowNumber);
    if (row === undefined) {
      continue;
    }
    for (let column = bounds.left; column <= bounds.right; column += 1) {
      const snapshot = row.cellAt(column);
      if (snapshot === undefined) {
        continue;
      }
      scannedCells += 1;
      const normalized = normalizeCell(snapshot, normalizeOptions);
      const haystacks: string[] = [];
      if (options.searchIn !== "formulas") {
        haystacks.push(renderScalar(normalized.value));
      }
      if (
        options.searchIn !== "values" &&
        typeof snapshot.formula === "string"
      ) {
        haystacks.push(`=${snapshot.formula}`);
      }
      if (!haystacks.some((text) => text !== "" && matcher.test(text))) {
        continue;
      }
      total += 1;
      if (found.length < options.maxResults) {
        found.push({
          address: formatCellRef(rowNumber, column),
          row: rowNumber,
          column,
          value: normalized.value,
        });
      }
    }
  }

  return {
    sheet: sheet.name,
    range: formatRange(bounds),
    total,
    truncated: total > found.length,
    scannedCells,
    matching: matcher.matching,
    matches: found,
  };
}

function renderScalar(value: CellScalar): string {
  if (value === null) {
    return "";
  }
  if (typeof value === "object") {
    return value.error;
  }
  return String(value);
}
