import type { OoxmlValidations, ValidationFormula } from "./ooxml/validations.js";
import { formatRectangle, parseCellRef } from "./range.js";

interface RowRun {
  readonly top: number;
  readonly bottom: number;
}

function toRuns(rows: number[]): RowRun[] {
  rows.sort((left, right) => left - right);
  const runs: RowRun[] = [];
  for (const row of rows) {
    const last = runs[runs.length - 1];
    if (last === undefined || row > last.bottom + 1) {
      runs.push({ top: row, bottom: row });
      continue;
    }
    if (row === last.bottom + 1) {
      runs[runs.length - 1] = { top: last.top, bottom: row };
    }
  }
  return runs;
}

export function compressAddresses(addresses: readonly string[]): string[] {
  const rowsByColumn = new Map<number, number[]>();
  for (const address of addresses) {
    const reference = parseCellRef(address);
    const rows = rowsByColumn.get(reference.column);
    if (rows === undefined) {
      rowsByColumn.set(reference.column, [reference.row]);
    } else {
      rows.push(reference.row);
    }
  }
  const runsByColumn = new Map<number, RowRun[]>();
  for (const [column, rows] of rowsByColumn) {
    runsByColumn.set(column, toRuns(rows));
  }
  const columns = [...runsByColumn.keys()].sort((left, right) => left - right);
  const ranges: string[] = [];
  let index = 0;
  while (index < columns.length) {
    const column = columns[index];
    if (column === undefined) {
      break;
    }
    const runs = runsByColumn.get(column) ?? [];
    const signature = JSON.stringify(runs);
    let last = index;
    while (last + 1 < columns.length) {
      const next = columns[last + 1];
      const current = columns[last];
      if (next === undefined || current === undefined || next !== current + 1) {
        break;
      }
      if (JSON.stringify(runsByColumn.get(next) ?? []) !== signature) {
        break;
      }
      last += 1;
    }
    const right = columns[last] ?? column;
    for (const run of runs) {
      ranges.push(formatRectangle(run.top, column, run.bottom, right));
    }
    index = last + 1;
  }
  return ranges;
}

export interface ValidationRule {
  readonly ranges: readonly string[];
  readonly rangesTruncated: boolean;
  readonly type: string;
  readonly operator?: string;
  readonly allowBlank?: boolean;
  readonly formulae?: readonly ValidationFormula[];
  readonly promptTitle?: string;
  readonly prompt?: string;
  readonly errorTitle?: string;
  readonly error?: string;
  readonly errorStyle?: string;
  readonly showInputMessage?: boolean;
  readonly showErrorMessage?: boolean;
}

export interface ValidationReport {
  readonly sheet: string;
  readonly count: number;
  readonly coveredCellCount: number;
  readonly rules: readonly ValidationRule[];
  readonly rangesTruncated: boolean;
}

/**
 * Reads straight from the `sqref` the file declares, so a rule covering a whole
 * column is one range rather than a million addresses. The ExcelJS-backed path
 * this replaces expanded every rule to one entry per cell, which is why it
 * needed a visit budget and reported a null count once it ran out.
 */
export function collectValidations(
  sheet: string,
  validations: OoxmlValidations | undefined,
): ValidationReport {
  const rules = validations?.rules ?? [];
  return {
    sheet,
    count: rules.length,
    coveredCellCount: validations?.coveredCellCount ?? 0,
    rules,
    rangesTruncated: validations?.rangesTruncated ?? false,
  };
}
