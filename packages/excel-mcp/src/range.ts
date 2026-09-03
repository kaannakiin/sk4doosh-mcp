import { SkMcpExcelError } from "./errors.js";
import { asciiUpper } from "./unicode.js";

export interface GridBounds {
  readonly top: number;
  readonly left: number;
  readonly bottom: number;
  readonly right: number;
}

const cellPattern = /^([A-Za-z]{1,3})([1-9][0-9]*)$/;
const columnPattern = /^[A-Za-z]{1,3}$/;
const rowPattern = /^[1-9][0-9]*$/;

export const maxColumn = 16_384;
export const maxRow = 1_048_576;

export function columnToLetters(index: number): string {
  if (!Number.isInteger(index) || index < 1 || index > maxColumn) {
    throw new SkMcpExcelError(
      "invalid_range",
      `Column index ${index} is out of bounds.`,
    );
  }
  let remaining = index;
  let letters = "";
  while (remaining > 0) {
    const rest = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

export function lettersToColumn(letters: string): number {
  let index = 0;
  for (const character of asciiUpper(letters)) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  if (index < 1 || index > maxColumn) {
    throw new SkMcpExcelError(
      "invalid_range",
      `Column '${letters}' is out of bounds.`,
    );
  }
  return index;
}

export interface CellRef {
  readonly row: number;
  readonly column: number;
}

export function parseCellRef(reference: string): CellRef {
  const match = cellPattern.exec(reference);
  if (!match) {
    throw new SkMcpExcelError(
      "invalid_range",
      `'${reference}' is not a cell reference.`,
      "Use A1 notation without dollar signs, for example B2.",
    );
  }
  const letters = match[1];
  const digits = match[2];
  if (letters === undefined || digits === undefined) {
    throw new SkMcpExcelError(
      "invalid_range",
      `'${reference}' is not a cell reference.`,
    );
  }
  const row = Number(digits);
  if (row > maxRow) {
    throw new SkMcpExcelError("invalid_range", `Row ${row} is out of bounds.`);
  }
  return { row, column: lettersToColumn(letters) };
}

export function formatCellRef(row: number, column: number): string {
  return `${columnToLetters(column)}${row}`;
}

export function formatRange(bounds: GridBounds): string {
  return `${formatCellRef(bounds.top, bounds.left)}:${formatCellRef(bounds.bottom, bounds.right)}`;
}

interface RangePart {
  readonly row?: number;
  readonly column?: number;
}

function parsePart(part: string): RangePart {
  if (part === "") {
    return {};
  }
  if (columnPattern.test(part)) {
    return { column: lettersToColumn(part) };
  }
  if (rowPattern.test(part)) {
    const row = Number(part);
    if (row > maxRow) {
      throw new SkMcpExcelError(
        "invalid_range",
        `Row ${row} is out of bounds.`,
      );
    }
    return { row };
  }
  const reference = parseCellRef(part);
  return { row: reference.row, column: reference.column };
}

export function resolveRange(
  used: GridBounds,
  requested: string | undefined,
): GridBounds {
  if (requested === undefined) {
    return used;
  }
  const trimmed = requested.trim();
  if (trimmed === "") {
    throw new SkMcpExcelError("invalid_range", "The range is empty.");
  }
  const segments = trimmed.split(":");
  if (segments.length > 2) {
    throw new SkMcpExcelError(
      "invalid_range",
      `'${requested}' has more than one ':' separator.`,
      "Use a form like B2:D40, B:D, 2:40 or B2.",
    );
  }
  const start = parsePart(segments[0] ?? "");
  const end = segments.length === 2 ? parsePart(segments[1] ?? "") : start;

  const bounds: GridBounds = {
    top: start.row ?? used.top,
    left: start.column ?? used.left,
    bottom: end.row ?? used.bottom,
    right: end.column ?? used.right,
  };
  if (bounds.bottom < bounds.top || bounds.right < bounds.left) {
    throw new SkMcpExcelError(
      "invalid_range",
      `'${requested}' ends before it starts.`,
      `Used range is ${formatRange(used)}.`,
    );
  }
  return clampToUsed(bounds, used, requested);
}

function clampToUsed(
  bounds: GridBounds,
  used: GridBounds,
  requested: string,
): GridBounds {
  const clamped: GridBounds = {
    top: Math.max(bounds.top, used.top),
    left: Math.max(bounds.left, used.left),
    bottom: Math.min(bounds.bottom, used.bottom),
    right: Math.min(bounds.right, used.right),
  };
  if (clamped.bottom < clamped.top || clamped.right < clamped.left) {
    throw new SkMcpExcelError(
      "range_outside_used_range",
      `Requested ${requested} but the used range is ${formatRange(used)}.`,
      `Pick a range inside ${formatRange(used)}.`,
    );
  }
  return clamped;
}

export function advance(
  bounds: GridBounds,
  cells: number,
): CellRef | undefined {
  const width = bounds.right - bounds.left + 1;
  const consumedRows = Math.floor(cells / width);
  const nextRow = bounds.top + consumedRows;
  if (nextRow > bounds.bottom) {
    return undefined;
  }
  return { row: nextRow, column: bounds.left };
}
