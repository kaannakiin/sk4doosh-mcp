import { z } from "zod";

import { LiaisoXmlError } from "../host/platform/errors.js";
import type {
  ElementStep,
  NamespaceBinding,
  NodeAddress,
} from "../model/node.js";
import type {
  ColumnSource,
  ColumnSpec,
  Condition,
  ItemSelector,
  MetricFunction,
  MetricRequest,
  NumericMode,
} from "../model/query.js";
import {
  addressStep,
  columns,
  itemAddress,
  namespaceBindings,
  where,
} from "./schemas.js";

export function stepsOf(
  raw: readonly z.infer<typeof addressStep>[] | undefined,
): NodeAddress | undefined {
  if (raw === undefined) return undefined;
  return raw.map((step): ElementStep => ({
    namespaceUri: step.namespaceUri,
    localName: step.localName,
    occurrence: step.occurrence ?? 1,
  }));
}

type RawBindings = z.infer<typeof namespaceBindings>;
type RawColumns = z.infer<typeof columns>;
type RawWhere = z.infer<typeof where>;
type RawItem = z.infer<typeof itemAddress>;

export function bindingsOf(
  raw: RawBindings | undefined,
): readonly NamespaceBinding[] {
  const seen = new Set<string>();
  const bound: NamespaceBinding[] = [];
  for (const binding of raw ?? []) {
    if (seen.has(binding.prefix)) {
      throw new LiaisoXmlError(
        "invalid_argument",
        `The prefix ${binding.prefix} is bound more than once.`,
        "Bind each prefix to one URI.",
      );
    }
    seen.add(binding.prefix);
    bound.push({ prefix: binding.prefix, uri: binding.uri });
  }
  return bound;
}

function sourceOf(raw: RawColumns[number]["value"]): ColumnSource {
  if (raw === undefined) return { from: "text" };
  if (raw.from === "attribute") {
    return {
      from: "attribute",
      attribute: { namespaceUri: raw.namespaceUri, localName: raw.localName },
    };
  }
  return { from: raw.from };
}

export function columnsOf(raw: RawColumns): readonly ColumnSpec[] {
  const labels = new Set<string>();
  return raw.map((column) => {
    if (labels.has(column.label)) {
      throw new LiaisoXmlError(
        "invalid_argument",
        `Two columns are labelled ${column.label}.`,
        "Give every column a distinct label; where and groupBy address columns by label.",
      );
    }
    labels.add(column.label);
    return {
      label: column.label,
      ancestors: stepsOf(column.ancestors) ?? [],
      ...(column.name === undefined ? {} : { name: column.name }),
      source: sourceOf(column.value),
      onMultiple: column.onMultiple ?? "error",
    };
  });
}

export function columnIndex(
  specs: readonly ColumnSpec[],
  label: string,
): number {
  const index = specs.findIndex((spec) => spec.label === label);
  if (index === -1) {
    throw new LiaisoXmlError(
      "invalid_argument",
      `There is no column labelled ${label}.`,
      `Declare it in columns first; the declared labels are ${specs.map((spec) => spec.label).join(", ")}.`,
    );
  }
  return index;
}

export function conditionsOf(
  raw: RawWhere | undefined,
  specs: readonly ColumnSpec[],
): readonly Condition[] {
  return (raw ?? []).map((condition) => {
    if (condition.op === "in" && condition.values === undefined) {
      throw new LiaisoXmlError(
        "invalid_argument",
        "The in operator needs values.",
        "Pass values with at least one entry, or use eq.",
      );
    }
    return {
      column: columnIndex(specs, condition.column),
      op: condition.op,
      ...(condition.value === undefined ? {} : { value: condition.value }),
      ...(condition.values === undefined ? {} : { values: condition.values }),
    };
  });
}

export function itemOf(raw: RawItem): ItemSelector {
  return { ancestors: stepsOf(raw.ancestors) ?? [], name: raw.name };
}

const countingMetrics = new Set(["count", "countValues", "countDistinct"]);

export function metricsOf(
  raw: readonly { readonly fn: MetricFunction; readonly column?: string }[],
  specs: readonly ColumnSpec[],
  mode: NumericMode,
): readonly MetricRequest[] {
  return raw.map((metric) => {
    if (metric.fn !== "count" && metric.column === undefined) {
      throw new LiaisoXmlError(
        "invalid_argument",
        `The ${metric.fn} metric needs a column.`,
        "Name a declared column, or use count for a plain record count.",
      );
    }
    if (!countingMetrics.has(metric.fn) && mode === "off") {
      throw new LiaisoXmlError(
        "invalid_argument",
        `The ${metric.fn} metric converts text to a binary64 number, which this call did not ask for.`,
        "Pass numericMode: binary64 to accept double precision, or use count, countValues or countDistinct.",
      );
    }
    return {
      fn: metric.fn,
      ...(metric.column === undefined
        ? {}
        : { column: columnIndex(specs, metric.column) }),
    };
  });
}

export function refuseCombination(field: string): never {
  throw new LiaisoXmlError(
    "invalid_argument",
    `cursor cannot be combined with ${field}.`,
    `Drop ${field}; the cursor pins the view it was produced for.`,
  );
}
