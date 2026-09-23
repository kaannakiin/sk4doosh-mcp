import type { XmlElement } from "libxml2-wasm";
import { addTo, newSum, sumOf, toNumber, type SumState } from "./numeric.js";
import type {
  AggregateOutcome,
  AggregateProbe,
  Cell,
  ColumnReport,
  GroupResult,
  MetricRequest,
  MetricValue,
} from "../model/query.js";
import {
  cellsOf,
  countInto,
  emptyReports,
  groupKeyOf,
  matchesWhere,
  presentCells,
  scanItems,
} from "./records.js";

interface MetricState {
  counted: number;
  skipped: number;
  rounded: number;
  distinct?: Set<string>;
  sum?: SumState;
  extreme?: number;
}

interface GroupState {
  readonly key: readonly Cell[];
  readonly encoded: string;
  readonly metrics: MetricState[];
  rows: number;
}

function newState(request: MetricRequest): MetricState {
  const base: MetricState = { counted: 0, skipped: 0, rounded: 0 };
  if (request.fn === "countDistinct") return { ...base, distinct: new Set() };
  if (request.fn === "sum" || request.fn === "avg") {
    return { ...base, sum: newSum() };
  }
  return base;
}

function textOf(cell: Cell): string | undefined {
  if (cell.status === "present") return cell.value;
  if (cell.status === "empty") return "";
  return undefined;
}

function accumulate(
  state: MetricState,
  request: MetricRequest,
  cell: Cell | undefined,
): void {
  if (request.fn === "count") {
    state.counted += 1;
    return;
  }
  if (cell === undefined) {
    state.skipped += 1;
    return;
  }
  if (request.fn === "countValues") {
    if (cell.status === "missing") state.skipped += 1;
    else state.counted += 1;
    return;
  }

  const text = textOf(cell);
  if (text === undefined) {
    state.skipped += 1;
    return;
  }

  if (request.fn === "countDistinct") {
    state.distinct?.add(text);
    state.counted += 1;
    return;
  }

  const parsed = toNumber(text);
  if (parsed === undefined) {
    state.skipped += 1;
    return;
  }
  state.counted += 1;
  if (parsed.rounded) state.rounded += 1;
  if (state.sum !== undefined) {
    addTo(state.sum, parsed.value);
    return;
  }
  if (state.extreme === undefined) {
    state.extreme = parsed.value;
    return;
  }
  const wins =
    request.fn === "min"
      ? parsed.value < state.extreme ||
        (parsed.value === state.extreme && Object.is(parsed.value, -0))
      : parsed.value > state.extreme ||
        (Object.is(state.extreme, -0) && parsed.value === 0);
  if (wins) state.extreme = parsed.value;
}

function numberMetric(state: MetricState, value: number): MetricValue {
  return {
    kind: "number",
    value: Object.is(value, -0) ? 0 : value,
    valueText: Object.is(value, -0) ? "-0" : String(value),
    ...(Object.is(value, -0) ? { negativeZero: true as const } : {}),
    counted: state.counted,
    skipped: state.skipped,
    rounded: state.rounded,
  };
}

function finish(
  state: MetricState,
  request: MetricRequest,
  rows: number,
): MetricValue {
  switch (request.fn) {
    case "count":
      return { kind: "count", value: rows };
    case "countValues":
      return { kind: "count", value: state.counted };
    case "countDistinct":
      return { kind: "count", value: state.distinct?.size ?? 0 };
    case "sum":
      return numberMetric(
        state,
        state.sum === undefined ? 0 : sumOf(state.sum),
      );
    case "avg":
      return state.counted === 0 || state.sum === undefined
        ? { kind: "undefined", counted: 0, skipped: state.skipped }
        : numberMetric(state, sumOf(state.sum) / state.counted);
    default:
      return state.extreme === undefined
        ? { kind: "undefined", counted: 0, skipped: state.skipped }
        : numberMetric(state, state.extreme);
  }
}

function rankOf(cell: Cell): number {
  if (cell.status === "present" || cell.status === "empty") return 0;
  if (cell.status === "missing") return 1;
  if (cell.status === "multiple") return 2;
  return 3;
}

function sortTextOf(cell: Cell): string {
  if (cell.status === "present") return cell.value;
  if (cell.status === "empty") return "";
  if (cell.status === "list") return cell.values.join("\u0000");
  return "";
}

/**
 * The encoded key carries length prefixes so that a missing value can never
 * collide with the text "missing"; ordering off that string would sort by
 * value length instead of by value, so the comparison walks the cells.
 */
function compareKeys(left: readonly Cell[], right: readonly Cell[]): number {
  const width = Math.max(left.length, right.length);
  for (let index = 0; index < width; index += 1) {
    const first = left[index];
    const second = right[index];
    if (first === undefined) return -1;
    if (second === undefined) return 1;
    const rank = rankOf(first) - rankOf(second);
    if (rank !== 0) return rank;
    const text = sortTextOf(first);
    const other = sortTextOf(second);
    if (text !== other) return text < other ? -1 : 1;
  }
  return 0;
}

function compareGroups(left: GroupState, right: GroupState): number {
  const byKey = compareKeys(left.key, right.key);
  if (byKey !== 0) return byKey;
  return left.encoded < right.encoded
    ? -1
    : left.encoded > right.encoded
      ? 1
      : 0;
}

/**
 * Ranks by the reported value, never the accumulator: `avg` holds a running
 * sum. An undefined metric sorts last in either direction.
 */
function compareMetric(
  left: MetricValue | undefined,
  right: MetricValue | undefined,
  direction: 1 | -1,
): number {
  const a =
    left === undefined || left.kind === "undefined" ? undefined : left.value;
  const b =
    right === undefined || right.kind === "undefined" ? undefined : right.value;
  if (a === undefined || b === undefined) {
    return a === b ? 0 : a === undefined ? 1 : -1;
  }
  return a === b ? 0 : (a < b ? -1 : 1) * direction;
}

interface FinishedGroup {
  readonly group: GroupState;
  readonly metrics: readonly MetricValue[];
}

export function aggregateDocument(
  root: XmlElement,
  probe: AggregateProbe,
): AggregateOutcome | undefined {
  const scan = scanItems(root, probe.item, probe.maxItemVisits);
  if (scan === undefined) return undefined;

  const reports: ColumnReport[] = emptyReports(probe.columns);
  const groups = new Map<string, GroupState>();
  let matched = 0;

  for (const visit of scan.items) {
    const cells = cellsOf(visit.element, probe.columns, probe);
    if (!matchesWhere(cells, probe.where, probe.match, probe.caseSensitive)) {
      continue;
    }
    matched += 1;
    countInto(reports, cells);

    const key = probe.groupBy.map(
      (index) => cells[index] ?? { status: "missing" as const },
    );
    const encoded = groupKeyOf(key);
    let group = groups.get(encoded);
    if (group === undefined) {
      group = {
        key,
        encoded,
        metrics: probe.metrics.map(newState),
        rows: 0,
      };
      groups.set(encoded, group);
    }
    group.rows += 1;
    probe.metrics.forEach((request, index) => {
      const state = group.metrics[index];
      if (state === undefined) return;
      accumulate(
        state,
        request,
        request.column === undefined ? undefined : cells[request.column],
      );
    });
  }

  const finished: FinishedGroup[] = [...groups.values()].map((group) => ({
    group,
    metrics: group.metrics.map((state, index) => {
      const request = probe.metrics[index];
      return request === undefined
        ? { kind: "count" as const, value: 0 }
        : finish(state, request, group.rows);
    }),
  }));
  const direction = probe.descending ? -1 : 1;
  const metricIndex = probe.orderByMetric - 1;
  const ordered = finished.sort((left, right) => {
    if (probe.orderBy !== "metric") {
      return compareGroups(left.group, right.group) * direction;
    }
    const byMetric = compareMetric(
      left.metrics[metricIndex],
      right.metrics[metricIndex],
      direction,
    );
    return byMetric !== 0 ? byMetric : compareGroups(left.group, right.group);
  });

  const kept = ordered.slice(0, probe.maxGroups);
  const results: GroupResult[] = kept.map(({ group, metrics }) => ({
    key: presentCells(group.key, probe.maxChars),
    rows: group.rows,
    metrics,
  }));

  return {
    groups: results,
    columns: reports,
    groupCount: groups.size,
    itemParentAddress: scan.parentAddress,
    itemName: probe.item.name,
    scannedItems: scan.scanned,
    matchedItems: matched,
    totalItems: scan.items.length,
    totalItemsExact: scan.complete,
    returnedMatchedItems: kept.reduce(
      (total, { group }) => total + group.rows,
      0,
    ),
    complete: scan.complete,
    groupsTruncated: kept.length < ordered.length,
  };
}
