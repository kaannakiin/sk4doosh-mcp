import { truncateWellFormed } from "@sk-mcp/file-core";
import type { MergePolicy, ValueMode } from "./cursor.js";
import { limits } from "./limits.js";

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

export interface CellFacts {
  readonly value: CellScalar;
  readonly truncatedFrom?: number;
  readonly href?: string;
}

export interface CellSnapshot {
  readonly merged: boolean;
  readonly value: CellFacts;
  readonly formula?: string;
  readonly cached?: CellFacts;
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

export const emptyCell: NormalizedCell = { value: null };

export function truncate(text: string): CellFacts {
  if (text.length <= limits.maxStringChars) {
    return { value: text };
  }
  return {
    value: truncateWellFormed(text, limits.maxStringChars),
    truncatedFrom: text.length,
  };
}

function noteOf(
  facts: CellFacts,
  options: NormalizeOptions,
): CellNote | undefined {
  if (facts.href !== undefined && options.includeHyperlinks) {
    return { kind: "hyperlink", href: facts.href };
  }
  if (facts.truncatedFrom !== undefined) {
    return { kind: "truncated", length: facts.truncatedFrom };
  }
  return undefined;
}

function present(facts: CellFacts, options: NormalizeOptions): NormalizedCell {
  const note = noteOf(facts, options);
  return note === undefined
    ? { value: facts.value }
    : { value: facts.value, note };
}

export function normalizeCell(
  snapshot: CellSnapshot,
  options: NormalizeOptions,
): NormalizedCell {
  if (snapshot.merged && options.mergePolicy === "master") {
    return emptyCell;
  }
  const formula = snapshot.formula;
  if (formula === undefined || formula === "") {
    return present(snapshot.value, options);
  }
  const text = `=${formula}`;
  const cached = snapshot.cached !== undefined;
  if (options.valueMode === "formulas") {
    return { value: text };
  }
  const scalar =
    snapshot.cached === undefined
      ? emptyCell
      : present(snapshot.cached, options);
  if (options.valueMode === "both" || !cached) {
    return {
      value: scalar.value,
      note: { kind: "formula", formula: text, cached },
    };
  }
  return scalar;
}
