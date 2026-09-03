import type { CellValue } from "exceljs";
import type { MergePolicy, ValueMode } from "./cursor.js";
import { limits } from "./limits.js";
import { truncateWellFormed } from "./unicode.js";

export const mergeValueType = 1;

export interface CellError {
  readonly error: string;
}

export type CellScalar = string | number | boolean | null | CellError;

export type CellNote =
  | {
      readonly kind: "formula";
      readonly formula: string;
      readonly cached: boolean;
    }
  | { readonly kind: "hyperlink"; readonly href: string }
  | { readonly kind: "truncated"; readonly length: number };

export interface CellSnapshot {
  readonly type: number;
  readonly value: CellValue;
  readonly formula?: string;
  readonly result?: CellValue;
  readonly numberFormat?: string;
}

export interface NormalizeOptions {
  readonly valueMode: ValueMode;
  readonly mergePolicy: MergePolicy;
  readonly includeHyperlinks: boolean;
}

export interface NormalizedCell {
  readonly value: CellScalar;
  readonly note?: CellNote;
}

const empty: NormalizedCell = { value: null };

function assertNever(value: never): never {
  throw new TypeError(`Unhandled cell value: ${JSON.stringify(value)}`);
}

function truncate(text: string): NormalizedCell {
  if (text.length <= limits.maxStringChars) {
    return { value: text };
  }
  return {
    value: truncateWellFormed(text, limits.maxStringChars),
    note: { kind: "truncated", length: text.length },
  };
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

function scalarize(
  value: CellValue,
  numberFormat: string | undefined,
  options: NormalizeOptions,
): NormalizedCell {
  if (value === null || value === undefined) {
    return empty;
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
    const text = truncate(value.text);
    if (!options.includeHyperlinks) {
      return text;
    }
    return {
      value: text.value,
      note: { kind: "hyperlink", href: value.hyperlink },
    };
  }
  if ("sharedFormula" in value) {
    return empty;
  }
  if ("formula" in value) {
    return empty;
  }
  return assertNever(value);
}

export function normalizeCell(
  snapshot: CellSnapshot,
  options: NormalizeOptions,
): NormalizedCell {
  if (snapshot.type === mergeValueType && options.mergePolicy === "master") {
    return empty;
  }
  const formula = snapshot.formula;
  if (formula === undefined || formula === "") {
    return scalarize(snapshot.value, snapshot.numberFormat, options);
  }
  const text = `=${formula}`;
  const cached = snapshot.result !== undefined;
  if (options.valueMode === "formulas") {
    return { value: text };
  }
  const scalar = cached
    ? scalarize(snapshot.result, snapshot.numberFormat, options)
    : empty;
  if (options.valueMode === "both" || !cached) {
    return {
      value: scalar.value,
      note: { kind: "formula", formula: text, cached },
    };
  }
  return scalar;
}
