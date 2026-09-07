import type { CellValue } from "exceljs";
import { truncate, type CellFacts, type CellSnapshot } from "./cell-value.js";

const mergeValueType = 1;

export interface XlsxCell {
  readonly type: number;
  readonly value: CellValue;
  readonly formula?: string;
  readonly result?: CellValue;
  readonly numberFormat?: string;
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled cell value: ${JSON.stringify(value)}`);
}

function hasTimeToken(numberFormat: string | undefined): boolean {
  if (numberFormat === undefined) {
    return false;
  }
  const stripped = numberFormat
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "");
  return /[hs]/i.test(stripped);
}

function formatDate(value: Date, numberFormat: string | undefined): string {
  const iso = value.toISOString();
  if (iso.endsWith("T00:00:00.000Z") && !hasTimeToken(numberFormat)) {
    return iso.slice(0, 10);
  }
  return iso;
}

function factsOf(
  value: CellValue,
  numberFormat: string | undefined,
): CellFacts {
  if (value === null || value === undefined) {
    return { value: null };
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return { value };
  }
  if (typeof value === "string") {
    return truncate(value);
  }
  if (value instanceof Date) {
    return { value: formatDate(value, numberFormat) };
  }
  if ("error" in value) {
    return { value: { error: value.error } };
  }
  if ("richText" in value) {
    return truncate(value.richText.map((run) => run.text).join(""));
  }
  if ("hyperlink" in value) {
    return { ...truncate(value.text), href: value.hyperlink };
  }
  if ("sharedFormula" in value) {
    return { value: null };
  }
  if ("formula" in value) {
    return { value: null };
  }
  return assertNever(value);
}

export function xlsxSnapshot(cell: XlsxCell): CellSnapshot {
  return {
    merged: cell.type === mergeValueType,
    value: factsOf(cell.value, cell.numberFormat),
    ...(cell.formula === undefined ? {} : { formula: cell.formula }),
    ...(cell.result === undefined
      ? {}
      : { cached: factsOf(cell.result, cell.numberFormat) }),
    ...(cell.numberFormat === undefined
      ? {}
      : { numberFormat: cell.numberFormat }),
  };
}
