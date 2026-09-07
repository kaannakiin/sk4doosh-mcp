import type { DataValidation, Worksheet } from "exceljs";
import { limits } from "./limits.js";
import { formatRectangle, parseCellRef } from "./range.js";
import { validationsOf } from "./workbook.js";

interface RowRun {
  readonly top: number;
  readonly bottom: number;
}

function stableKey(rule: DataValidation): string {
  const entries = Object.entries(
    rule as unknown as Record<string, unknown>,
  ).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return JSON.stringify(entries);
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
  readonly type: DataValidation["type"];
  readonly operator?: DataValidation["operator"];
  readonly allowBlank?: boolean;
  readonly formulae?: readonly unknown[];
  readonly promptTitle?: string;
  readonly prompt?: string;
  readonly errorTitle?: string;
  readonly error?: string;
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

export function collectValidations(worksheet: Worksheet): ValidationReport {
  const model = validationsOf(worksheet);
  const groups = new Map<
    string,
    { rule: DataValidation; addresses: string[] }
  >();
  let coveredCellCount = 0;
  for (const [address, rule] of Object.entries(model)) {
    if (rule === undefined) {
      continue;
    }
    coveredCellCount += 1;
    const key = stableKey(rule);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { rule, addresses: [address] });
    } else {
      group.addresses.push(address);
    }
  }
  let rangesTruncated = false;
  const rules = [...groups.values()].map((group): ValidationRule => {
    const ranges = compressAddresses(group.addresses);
    const truncated = ranges.length > limits.maxRangesPerRule;
    rangesTruncated = rangesTruncated || truncated;
    const rule = group.rule;
    return {
      ranges: truncated ? ranges.slice(0, limits.maxRangesPerRule) : ranges,
      rangesTruncated: truncated,
      type: rule.type,
      ...(rule.operator === undefined ? {} : { operator: rule.operator }),
      ...(rule.allowBlank === undefined ? {} : { allowBlank: rule.allowBlank }),
      ...(rule.formulae === undefined ? {} : { formulae: rule.formulae }),
      ...(rule.promptTitle === undefined
        ? {}
        : { promptTitle: rule.promptTitle }),
      ...(rule.prompt === undefined ? {} : { prompt: rule.prompt }),
      ...(rule.errorTitle === undefined ? {} : { errorTitle: rule.errorTitle }),
      ...(rule.error === undefined ? {} : { error: rule.error }),
      ...(rule.showInputMessage === undefined
        ? {}
        : { showInputMessage: rule.showInputMessage }),
      ...(rule.showErrorMessage === undefined
        ? {}
        : { showErrorMessage: rule.showErrorMessage }),
    };
  });
  return {
    sheet: worksheet.name,
    count: rules.length,
    coveredCellCount,
    rules,
    rangesTruncated,
  };
}
