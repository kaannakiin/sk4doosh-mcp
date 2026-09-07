import { fold } from "@sk-mcp/file-core";
import type { CellScalar } from "./cell-value.js";
import { SkMcpExcelError } from "./errors.js";

export type CellKind =
  "number" | "date" | "text" | "boolean" | "error" | "empty";

export type ComparableKind = "number" | "date" | "text";

export const kindPrecedence: readonly CellKind[] = [
  "number",
  "date",
  "text",
  "boolean",
  "error",
  "empty",
];

const isoDate = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}\.\d{3}Z)?$/;
const numericText = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

export function classify(value: CellScalar): CellKind {
  if (value === null) {
    return "empty";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "object") {
    return "error";
  }
  return isoDate.test(value) ? "date" : "text";
}

export function isNumericText(value: CellScalar): boolean {
  return typeof value === "string" && numericText.test(value.trim());
}

export function coerceNumber(value: CellScalar): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (isNumericText(value)) {
    return Number((value as string).trim());
  }
  return undefined;
}

function expandDate(value: string): string {
  return value.length === 10 ? `${value}T00:00:00.000Z` : value;
}

function orderKey(
  kind: ComparableKind,
  value: CellScalar,
  caseSensitive: boolean,
): string | number {
  if (kind === "number") {
    return value as number;
  }
  if (kind === "date") {
    return expandDate(value as string);
  }
  return caseSensitive ? (value as string) : fold(value as string);
}

export function compareWithin(
  kind: ComparableKind,
  left: CellScalar,
  right: CellScalar,
  caseSensitive: boolean,
): number {
  const a = orderKey(kind, left, caseSensitive);
  const b = orderKey(kind, right, caseSensitive);
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

export type Operator =
  | "eq"
  | "ne"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "in"
  | "between"
  | "isEmpty"
  | "isNotEmpty"
  | "isError"
  | "isNumber"
  | "isText";

export type PredicateScalar = string | number | boolean;

export interface Condition {
  readonly column: string;
  readonly op: Operator;
  readonly value?: PredicateScalar;
  readonly values?: readonly PredicateScalar[];
}

export interface PredicateOptions {
  readonly caseSensitive: boolean;
  readonly coerceText: boolean;
}

const orderingOperators = new Set<Operator>(["lt", "lte", "gt", "gte"]);
const textOperators = new Set<Operator>(["contains", "startsWith", "endsWith"]);
const nullaryOperators = new Set<Operator>([
  "isEmpty",
  "isNotEmpty",
  "isNumber",
  "isText",
]);

function operandKind(value: PredicateScalar): CellKind {
  return classify(value as CellScalar);
}

function requireOperand(condition: Condition): PredicateScalar {
  if (condition.value === undefined) {
    throw new SkMcpExcelError(
      "invalid_argument",
      `Operator '${condition.op}' on column '${condition.column}' needs a value.`,
      "Pass value, or use isEmpty / isNotEmpty for blank checks.",
    );
  }
  return condition.value;
}

function comparableKindOf(
  condition: Condition,
  operand: PredicateScalar,
): ComparableKind {
  const kind = operandKind(operand);
  if (kind === "number" || kind === "date" || kind === "text") {
    return kind;
  }
  throw new SkMcpExcelError(
    "invalid_argument",
    `Operator '${condition.op}' on column '${condition.column}' cannot compare against a ${kind} value.`,
    "Compare against a number, an ISO date string, or text.",
  );
}

export function validateCondition(condition: Condition): void {
  if (nullaryOperators.has(condition.op)) {
    return;
  }
  if (condition.op === "isError") {
    return;
  }
  if (condition.op === "in") {
    if (condition.values === undefined || condition.values.length === 0) {
      throw new SkMcpExcelError(
        "invalid_argument",
        `Operator 'in' on column '${condition.column}' needs a non-empty values array.`,
        "Pass values, or use eq for a single comparison.",
      );
    }
    return;
  }
  if (condition.op === "between") {
    const pair = condition.values;
    if (pair === undefined || pair.length !== 2) {
      throw new SkMcpExcelError(
        "invalid_argument",
        `Operator 'between' on column '${condition.column}' needs exactly two values.`,
        "Pass values as [low, high].",
      );
    }
    const [low, high] = pair as [PredicateScalar, PredicateScalar];
    const kind = comparableKindOf(condition, low);
    if (compareWithin(kind, low as CellScalar, high as CellScalar, true) > 0) {
      throw new SkMcpExcelError(
        "invalid_argument",
        `Operator 'between' on column '${condition.column}' was given a low bound above its high bound.`,
        "Swap the two values.",
      );
    }
    return;
  }
  const operand = requireOperand(condition);
  if (orderingOperators.has(condition.op)) {
    comparableKindOf(condition, operand);
  }
  if (textOperators.has(condition.op) && typeof operand !== "string") {
    throw new SkMcpExcelError(
      "invalid_argument",
      `Operator '${condition.op}' on column '${condition.column}' needs text on the right.`,
      "Pass a string, or use eq for an exact comparison.",
    );
  }
}

function textOf(value: CellScalar, caseSensitive: boolean): string | undefined {
  if (classify(value) !== "text" && classify(value) !== "date") {
    return undefined;
  }
  const text = value as string;
  return caseSensitive ? text : fold(text);
}

export function evaluate(
  condition: Condition,
  cell: CellScalar,
  options: PredicateOptions,
): boolean {
  const value =
    options.coerceText && isNumericText(cell)
      ? (coerceNumber(cell) as CellScalar)
      : cell;
  const kind = classify(value);

  switch (condition.op) {
    case "isEmpty":
      return kind === "empty";
    case "isNotEmpty":
      return kind !== "empty";
    case "isError":
      return (
        kind === "error" &&
        (condition.value === undefined ||
          (value as { error: string }).error === condition.value)
      );
    case "isNumber":
      return kind === "number";
    case "isText":
      return kind === "text";
    default:
      break;
  }

  if (condition.op === "in") {
    return (condition.values ?? []).some((entry) =>
      evaluate(
        { column: condition.column, op: "eq", value: entry },
        value,
        options,
      ),
    );
  }

  if (condition.op === "between") {
    const [low, high] = (condition.values ?? []) as [
      PredicateScalar,
      PredicateScalar,
    ];
    const bound = comparableKindOf(condition, low);
    if (kind !== bound) {
      return false;
    }
    return (
      compareWithin(bound, value, low as CellScalar, options.caseSensitive) >=
        0 &&
      compareWithin(bound, value, high as CellScalar, options.caseSensitive) <=
        0
    );
  }

  const operand = requireOperand(condition);

  if (textOperators.has(condition.op)) {
    const haystack = textOf(value, options.caseSensitive);
    if (haystack === undefined) {
      return false;
    }
    const needle = options.caseSensitive
      ? (operand as string)
      : fold(operand as string);
    if (condition.op === "contains") {
      return haystack.includes(needle);
    }
    if (condition.op === "startsWith") {
      return haystack.startsWith(needle);
    }
    return haystack.endsWith(needle);
  }

  const wanted = operandKind(operand);
  if (condition.op === "eq" || condition.op === "ne") {
    const same =
      kind === wanted &&
      (kind === "text" || kind === "date"
        ? compareWithin(
            kind,
            value,
            operand as CellScalar,
            options.caseSensitive,
          ) === 0
        : value === operand);
    return condition.op === "eq" ? same : !same;
  }

  const bound = comparableKindOf(condition, operand);
  if (kind !== bound) {
    return false;
  }
  const order = compareWithin(
    bound,
    value,
    operand as CellScalar,
    options.caseSensitive,
  );
  if (condition.op === "lt") {
    return order < 0;
  }
  if (condition.op === "lte") {
    return order <= 0;
  }
  if (condition.op === "gt") {
    return order > 0;
  }
  return order >= 0;
}

export interface Census {
  numbers: number;
  dates: number;
  texts: number;
  booleans: number;
  errors: number;
  nulls: number;
  numericTexts: number;
}

export function emptyCensus(): Census {
  return {
    numbers: 0,
    dates: 0,
    texts: 0,
    booleans: 0,
    errors: 0,
    nulls: 0,
    numericTexts: 0,
  };
}

export function record(census: Census, value: CellScalar): CellKind {
  const kind = classify(value);
  if (kind === "number") {
    census.numbers += 1;
  } else if (kind === "date") {
    census.dates += 1;
  } else if (kind === "text") {
    census.texts += 1;
    if (isNumericText(value)) {
      census.numericTexts += 1;
    }
  } else if (kind === "boolean") {
    census.booleans += 1;
  } else if (kind === "error") {
    census.errors += 1;
  } else {
    census.nulls += 1;
  }
  return kind;
}

export function reportCensus(census: Census): Partial<Census> {
  const out: Partial<Census> = {};
  for (const [key, count] of Object.entries(census) as [
    keyof Census,
    number,
  ][]) {
    if (count > 0) {
      out[key] = count;
    }
  }
  return out;
}

export function majorityKind(census: Census): ComparableKind {
  const counts: Readonly<Record<ComparableKind, number>> = {
    number: census.numbers,
    date: census.dates,
    text: census.texts,
  };
  let best: ComparableKind = "number";
  for (const kind of ["number", "date", "text"] as const) {
    if (counts[kind] > counts[best]) {
      best = kind;
    }
  }
  return best;
}
