import { fold } from "@sk-mcp/file-core";
import type { CellScalar } from "./cell-value.js";
import {
  buildColumnIndex,
  resolveColumn,
  type ColumnIndex,
  type ColumnMode,
} from "./columns.js";
import { SkMcpExcelError } from "./errors.js";
import {
  headerWarnings,
  readHeaderRow,
  type HeaderRowSource,
} from "./header.js";
import { limits } from "./limits.js";
import {
  classify,
  compareWithin,
  coerceNumber,
  emptyCensus,
  evaluate,
  kindPrecedence,
  majorityKind,
  record,
  reportCensus,
  validateCondition,
  type Census,
  type ComparableKind,
  type Condition,
  type PredicateOptions,
} from "./predicate.js";
import { columnToLetters, formatRange, resolveRange } from "./range.js";
import { normalizeCell } from "./cell-value.js";
import type { SheetView } from "./sheet.js";
import { requireSheetBounds, type SheetSource } from "./sheet.js";

export type MetricFunction =
  | "count"
  | "countValues"
  | "countDistinct"
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "stddev";

export interface MetricRequest {
  readonly fn: MetricFunction;
  readonly column?: string;
}

export interface AggregateOptions {
  readonly sheetName?: string;
  readonly range?: string;
  readonly groupBy?: readonly string[];
  readonly metrics: readonly MetricRequest[];
  readonly where?: readonly Condition[];
  readonly match: "all" | "any";
  readonly headerRow: number;
  readonly columnMode: ColumnMode;
  readonly caseSensitive: boolean;
  readonly coerceText: boolean;
  readonly mergedCells: "master" | "repeat";
  readonly orderBy: "group" | "metric";
  readonly orderByMetric?: number;
  readonly descending: boolean;
  readonly maxGroups: number;
  readonly headerRowSource: HeaderRowSource;
}

export interface AggregateColumn {
  readonly label: string;
  readonly letter?: string;
  readonly role: "group" | "metric";
  readonly fn?: MetricFunction;
  readonly counted?: number;
  readonly skipped?: number;
  readonly kindUsed?: ComparableKind;
}

export interface AggregateResult {
  readonly sheet: string;
  readonly range: string;
  readonly usedRange: string;
  readonly headerRow: number;
  readonly headerRowSource: HeaderRowSource;
  readonly columns: readonly AggregateColumn[];
  readonly rows: readonly (readonly CellScalar[])[];
  readonly groupCount: number;
  readonly returnedGroups: number;
  readonly scannedRows: number;
  readonly matchedRows: number;
  readonly returnedMatchedRows: number;
  readonly omittedMatchedRows: number;
  readonly firstScannedRow: number;
  readonly blankRows: number;
  readonly columnStats?: Readonly<Record<string, Partial<Census>>>;
  readonly truncated: boolean;
  readonly truncationReason?: "maxGroups";
  readonly hint?: string;
  readonly warnings?: readonly string[];
}

interface SumState {
  sum: number;
  compensation: number;
}

interface MetricState {
  counted: number;
  skipped: number;
  readonly sums: SumState;
  distinct: Set<string> | undefined;
  extreme:
    | { readonly kind: "number"; readonly value: number }
    | { readonly kind: "text" | "date"; readonly value: string }
    | undefined;
  mean: number;
  m2: number;
}

interface GroupState {
  readonly key: readonly CellScalar[];
  readonly metrics: MetricState[];
  rows: number;
}

function accumulate(state: SumState, value: number): void {
  const total = finite(state.sum + value);
  state.compensation = finite(
    state.compensation +
      (Math.abs(state.sum) >= Math.abs(value)
        ? state.sum - total + value
        : value - total + state.sum),
  );
  state.sum = total;
}

function sumOf(state: SumState): number {
  return finite(state.sum + state.compensation);
}

function finite(value: number): number {
  if (!Number.isFinite(value))
    throw new SkMcpExcelError(
      "numeric_overflow",
      "A metric calculation exceeded the finite number range.",
      "Narrow the range or scale the numeric values.",
    );
  return value;
}

function newMetricState(fn: MetricFunction): MetricState {
  return {
    counted: 0,
    skipped: 0,
    sums: { sum: 0, compensation: 0 },
    distinct: fn === "countDistinct" ? new Set<string>() : undefined,
    extreme: undefined,
    mean: 0,
    m2: 0,
  };
}

interface GridRead {
  readonly value: CellScalar;
  readonly uncachedFormula: boolean;
}

function readGrid(
  sheet: SheetView,
  row: number,
  column: number,
  mergedCells: "master" | "repeat",
): GridRead {
  const snapshot = sheet.rowAt(row)?.cellAt(column);
  if (snapshot === undefined) {
    return { value: null, uncachedFormula: false };
  }
  const normalized = normalizeCell(snapshot, {
    valueMode: "values",
    mergePolicy: mergedCells,
    includeHyperlinks: false,
  });
  return {
    value: normalized.value,
    uncachedFormula:
      normalized.note?.kind === "formula" && !normalized.note.cached,
  };
}

function keyOf(values: readonly CellScalar[]): string {
  return JSON.stringify(values);
}

function compareKeys(
  left: readonly CellScalar[],
  right: readonly CellScalar[],
  caseSensitive: boolean,
): number {
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? null;
    const b = right[index] ?? null;
    const ka = classify(a);
    const kb = classify(b);
    if (ka !== kb) {
      return kindPrecedence.indexOf(ka) - kindPrecedence.indexOf(kb);
    }
    if (ka === "number" || ka === "date" || ka === "text") {
      const order = compareWithin(ka, a, b, caseSensitive);
      if (order !== 0) {
        return order;
      }
      continue;
    }
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    if (sa !== sb) {
      return sa < sb ? -1 : 1;
    }
  }
  return 0;
}

function metricLabel(metric: MetricRequest): string {
  return metric.column === undefined
    ? metric.fn
    : `${metric.fn}(${metric.column})`;
}

function finish(metric: MetricRequest, state: MetricState): CellScalar {
  switch (metric.fn) {
    case "count":
      return state.counted;
    case "countValues":
      return state.counted;
    case "countDistinct":
      return state.distinct?.size ?? 0;
    case "sum":
      return state.counted === 0 ? null : sumOf(state.sums);
    case "avg":
      return state.counted === 0 ? null : sumOf(state.sums) / state.counted;
    case "stddev":
      return state.counted < 2
        ? null
        : finite(Math.sqrt(state.m2 / (state.counted - 1)));
    default:
      return state.extreme?.value ?? null;
  }
}

export function aggregateSheet(
  source: SheetSource,
  options: AggregateOptions,
): AggregateResult {
  if (options.metrics.length === 0) {
    throw new SkMcpExcelError(
      "invalid_argument",
      "At least one metric is required.",
      'Pass metrics, for example [{"fn":"count"}].',
    );
  }
  if (
    options.orderByMetric !== undefined &&
    (!Number.isSafeInteger(options.orderByMetric) ||
      options.orderByMetric < 1 ||
      options.orderByMetric > options.metrics.length)
  ) {
    throw new SkMcpExcelError(
      "invalid_argument",
      "orderByMetric must identify an entry in metrics.",
    );
  }
  const sheet = source.sheetFor(options.sheetName);
  const used = requireSheetBounds(sheet);
  const bounds = resolveRange(used, options.range);

  const headers = readHeaderRow(sheet, bounds, options.headerRow, {
    valueMode: "values",
    mergePolicy: options.mergedCells,
    includeHyperlinks: false,
  });
  const index: ColumnIndex = buildColumnIndex(
    `${sheet.name}!${formatRange(bounds)}`,
    bounds,
    options.headerRow,
    headers,
  );

  const groupColumns = (options.groupBy ?? []).map((reference) => ({
    reference,
    column: resolveColumn(index, reference, options.columnMode),
  }));
  const metricColumns = options.metrics.map((metric) => ({
    metric,
    column:
      metric.column === undefined
        ? undefined
        : resolveColumn(index, metric.column, options.columnMode),
  }));
  for (const entry of metricColumns) {
    if (entry.metric.fn !== "count" && entry.column === undefined) {
      throw new SkMcpExcelError(
        "invalid_argument",
        `Metric '${entry.metric.fn}' needs a column.`,
        "Pass column, or use fn 'count' to count rows.",
      );
    }
  }
  const conditions = (options.where ?? []).map((condition) => {
    validateCondition(condition, options.caseSensitive);
    return {
      condition,
      column: resolveColumn(index, condition.column, options.columnMode),
    };
  });

  const predicateOptions: PredicateOptions = {
    caseSensitive: options.caseSensitive,
    coerceText: options.coerceText,
  };
  const census = new Map<number, Census>();
  const censusFor = (column: number): Census => {
    const existing = census.get(column);
    if (existing !== undefined) {
      return existing;
    }
    const fresh = emptyCensus();
    census.set(column, fresh);
    return fresh;
  };

  const groups = new Map<string, GroupState>();
  const startRow =
    options.headerRow >= bounds.top && options.headerRow <= bounds.bottom
      ? Math.max(bounds.top, options.headerRow + 1)
      : bounds.top;

  let scannedRows = 0;
  let matchedRows = 0;
  let uncachedFormulas = 0;
  let blankRows = 0;

  for (let row = startRow; row <= bounds.bottom; row += 1) {
    scannedRows += 1;
    const rowView = sheet.rowAt(row);
    let blank = true;
    if (rowView !== undefined) {
      for (let column = bounds.left; column <= bounds.right; column += 1) {
        const snapshot = rowView.cellAt(column);
        if (snapshot === undefined) {
          continue;
        }
        if (
          normalizeCell(snapshot, {
            valueMode: "values",
            mergePolicy: options.mergedCells,
            includeHyperlinks: false,
          }).value !== null
        ) {
          blank = false;
          break;
        }
      }
    }
    if (blank) {
      blankRows += 1;
    }
    const cellAt = (column: number): CellScalar => {
      const read = readGrid(sheet, row, column, options.mergedCells);
      if (read.uncachedFormula) {
        uncachedFormulas += 1;
      }
      return read.value;
    };

    let matched = conditions.length === 0 ? true : options.match === "all";
    for (const entry of conditions) {
      const hit = evaluate(
        entry.condition,
        cellAt(entry.column),
        predicateOptions,
      );
      matched = options.match === "all" ? matched && hit : matched || hit;
    }
    if (!matched) {
      continue;
    }
    matchedRows += 1;

    const key = groupColumns.map((entry) => cellAt(entry.column));
    const id = keyOf(key);
    let group = groups.get(id);
    if (group === undefined) {
      group = {
        key,
        rows: 0,
        metrics: options.metrics.map((metric) => newMetricState(metric.fn)),
      };
      groups.set(id, group);
    }
    group.rows += 1;

    for (let slot = 0; slot < metricColumns.length; slot += 1) {
      const entry = metricColumns[slot];
      const state = group.metrics[slot];
      if (entry === undefined || state === undefined) {
        continue;
      }
      if (entry.metric.fn === "count") {
        state.counted += 1;
        continue;
      }
      const column = entry.column as number;
      const raw = cellAt(column);
      const kind = record(censusFor(column), raw);
      if (kind === "empty") {
        state.skipped += 1;
        continue;
      }
      const value =
        options.coerceText && kind === "text"
          ? (coerceNumber(raw) ?? raw)
          : raw;

      if (entry.metric.fn === "countValues") {
        state.counted += 1;
        continue;
      }
      if (entry.metric.fn === "countDistinct") {
        state.counted += 1;
        state.distinct?.add(JSON.stringify(value));
        continue;
      }
      if (entry.metric.fn === "min" || entry.metric.fn === "max") {
        const kindNow = classify(value);
        if (kindNow !== "number" && kindNow !== "date" && kindNow !== "text") {
          state.skipped += 1;
          continue;
        }
        state.counted += 1;
        if (kindNow === "number") coerceNumber(value);
        const candidate =
          typeof value === "number"
            ? { kind: "number" as const, value }
            : typeof value === "string"
              ? {
                  kind:
                    kindNow === "date" ? ("date" as const) : ("text" as const),
                  value,
                }
              : undefined;
        if (candidate === undefined) continue;
        if (state.extreme === undefined) {
          state.extreme = candidate;
          continue;
        }
        if (state.extreme.kind !== candidate.kind)
          throw new SkMcpExcelError(
            "invalid_argument",
            `Metric '${entry.metric.fn}' mixes ${state.extreme.kind} and ${candidate.kind} at ${columnToLetters(column)}${row}.`,
            "Use a homogeneous range or filter the source values.",
          );
        const order = compareWithin(
          kindNow,
          value,
          state.extreme.value,
          options.caseSensitive,
        );
        if (entry.metric.fn === "min" ? order < 0 : order > 0) {
          state.extreme = candidate;
        }
        continue;
      }
      const numeric =
        typeof value === "number" ? coerceNumber(value) : undefined;
      if (numeric === undefined) {
        state.skipped += 1;
        continue;
      }
      state.counted += 1;
      if (entry.metric.fn === "sum" || entry.metric.fn === "avg")
        accumulate(state.sums, numeric);
      if (entry.metric.fn === "stddev") {
        const delta = finite(numeric - state.mean);
        state.mean = finite(state.mean + delta / state.counted);
        state.m2 = finite(
          state.m2 + finite(delta * finite(numeric - state.mean)),
        );
      }
    }
  }

  const ordered = [...groups.values()];
  const metricSlot = (options.orderByMetric ?? 1) - 1;
  ordered.sort((left, right) => {
    if (options.orderBy === "metric") {
      const a = finish(
        options.metrics[metricSlot] as MetricRequest,
        left.metrics[metricSlot] as MetricState,
      );
      const b = finish(
        options.metrics[metricSlot] as MetricRequest,
        right.metrics[metricSlot] as MetricState,
      );
      const av = typeof a === "number" ? a : Number.NEGATIVE_INFINITY;
      const bv = typeof b === "number" ? b : Number.NEGATIVE_INFINITY;
      if (av !== bv) {
        return options.descending ? bv - av : av - bv;
      }
      return compareKeys(left.key, right.key, options.caseSensitive);
    }
    const order = compareKeys(left.key, right.key, options.caseSensitive);
    if (order !== 0) {
      return options.descending ? -order : order;
    }
    return 0;
  });

  const truncated = ordered.length > options.maxGroups;
  const page = ordered.slice(0, options.maxGroups);

  const columns: AggregateColumn[] = [
    ...groupColumns.map((entry): AggregateColumn => {
      const header = headers[entry.column - bounds.left];
      return {
        label: header ?? columnToLetters(entry.column),
        letter: columnToLetters(entry.column),
        role: "group",
      };
    }),
    ...metricColumns.map((entry, slot): AggregateColumn => {
      const counted = page.reduce(
        (total, group) => total + (group.metrics[slot]?.counted ?? 0),
        0,
      );
      const skipped = page.reduce(
        (total, group) => total + (group.metrics[slot]?.skipped ?? 0),
        0,
      );
      const kindUsed =
        entry.metric.fn === "min" || entry.metric.fn === "max"
          ? majorityKind(censusFor(entry.column as number))
          : undefined;
      return {
        label: metricLabel(entry.metric),
        ...(entry.column === undefined
          ? {}
          : { letter: columnToLetters(entry.column) }),
        role: "metric",
        fn: entry.metric.fn,
        counted,
        skipped,
        ...(kindUsed === undefined ? {} : { kindUsed }),
      };
    }),
  ];

  const rows =
    page.length === 0 && groupColumns.length === 0
      ? [
          [
            ...options.metrics.map((metric) =>
              metric.fn === "count" ? 0 : null,
            ),
          ] as CellScalar[],
        ]
      : page.map((group) => [
          ...group.key,
          ...options.metrics.map((metric, slot) =>
            finish(metric, group.metrics[slot] as MetricState),
          ),
        ]);

  const stats: Record<string, Partial<Census>> = {};
  for (const [column, counted] of census) {
    const reported = reportCensus(counted);
    if (Object.keys(reported).length > 0) {
      stats[columnToLetters(column)] = reported;
    }
  }

  const warnings: string[] = [
    ...headerWarnings(
      sheet,
      bounds,
      options.headerRow,
      headers,
      options.range !== undefined,
      options.mergedCells,
    ),
  ];
  const collisions = new Map<string, Set<string>>();
  for (const group of ordered) {
    const label = group.key
      .map((value) =>
        typeof value === "string" ? fold(value) : JSON.stringify(value),
      )
      .join("\u0000");
    const bucket = collisions.get(label) ?? new Set<string>();
    bucket.add(
      group.key
        .map((value) =>
          typeof value === "string" ? value : JSON.stringify(value),
        )
        .join(" / "),
    );
    collisions.set(label, bucket);
  }
  for (const bucket of collisions.values()) {
    if (bucket.size > 1) {
      warnings.push(
        `Groups ${[...bucket].map((entry) => `'${entry}'`).join(" and ")} differ only by case or accent.`,
      );
    }
  }
  const numericTextColumns = [...census.entries()].filter(
    ([, counted]) => counted.numericTexts > 0,
  );
  if (!options.coerceText && numericTextColumns.length > 0) {
    warnings.push(
      `${numericTextColumns
        .map(
          ([column, counted]) =>
            `${columnToLetters(column)} (${counted.numericTexts})`,
        )
        .join(
          ", ",
        )} hold numeric text such as "1234.50". Pass coerceText true to include them in the totals.`,
    );
  }
  if (uncachedFormulas > 0) {
    warnings.push(
      `${uncachedFormulas} formula cells in the aggregated columns have no cached value; the totals exclude them.`,
    );
  }

  return {
    sheet: sheet.name,
    range: formatRange(bounds),
    usedRange: formatRange(used),
    headerRow: options.headerRow,
    headerRowSource: options.headerRowSource,
    columns,
    rows,
    groupCount: ordered.length,
    returnedGroups: page.length,
    scannedRows,
    matchedRows,
    returnedMatchedRows: page.reduce((sum, group) => sum + group.rows, 0),
    omittedMatchedRows:
      matchedRows - page.reduce((sum, group) => sum + group.rows, 0),
    firstScannedRow: startRow,
    blankRows,
    ...(Object.keys(stats).length > 0 ? { columnStats: stats } : {}),
    truncated,
    ...(truncated ? { truncationReason: "maxGroups" as const } : {}),
    ...(truncated
      ? {
          hint: `${ordered.length} distinct groups; the first ${page.length} in ${options.orderBy} order were returned. Set orderBy to "metric" with orderByMetric to get the top groups, or add a where clause.`,
        }
      : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export const aggregateLimits = {
  maxGroupsDefault: limits.maxGroupsDefault,
  maxGroupsHard: limits.maxGroupsHard,
} as const;
