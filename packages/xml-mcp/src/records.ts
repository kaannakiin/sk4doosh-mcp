import { XmlCData, XmlDocument, XmlElement, XmlText } from "libxml2-wasm";
import { HARDENED } from "./parse-policy.js";
import { asciiLower } from "./text.js";
import {
  formatNodeId,
  sameName,
  type ExpandedName,
  type NodeAddress,
  type NodePath,
} from "./node-model.js";
import type {
  Cell,
  ChunkPage,
  ChunkProbe,
  ColumnReport,
  ColumnSpec,
  Condition,
  ItemSelector,
  MatchMode,
  RecordPage,
  RecordProbe,
  Row,
  ScanLimits,
} from "./query-model.js";
import {
  clampChars,
  firstChildOf,
  nextSibling,
  resolveAddress,
} from "./traverse.js";

export interface ItemVisit {
  readonly element: XmlElement;
  readonly occurrence: number;
  readonly path: NodePath;
}

export interface ItemScan {
  readonly parentAddress: NodeAddress;
  readonly items: readonly ItemVisit[];
  readonly scanned: number;
  readonly complete: boolean;
}

export function scanItems(
  root: XmlElement,
  selector: ItemSelector,
  maxVisits: number,
): ItemScan | undefined {
  const parent = resolveAddress(root, selector.ancestors);
  if (parent === undefined) return undefined;

  const items: ItemVisit[] = [];
  let childIndex = 1;
  let occurrence = 0;
  let scanned = 0;
  let complete = true;

  for (
    let child = firstChildOf(parent.element);
    child !== undefined;
    child = nextSibling(child)
  ) {
    if (child instanceof XmlElement) {
      scanned += 1;
      if (
        sameName(selector.name, {
          namespaceUri: child.namespaceUri,
          localName: child.name,
        })
      ) {
        occurrence += 1;
        items.push({
          element: child,
          occurrence,
          path: [...parent.path, childIndex],
        });
      }
      if (scanned >= maxVisits) {
        complete = false;
        break;
      }
    }
    childIndex += 1;
  }

  return { parentAddress: parent.address, items, scanned, complete };
}

function attributeValue(
  element: XmlElement,
  name: ExpandedName,
): string | undefined {
  for (const attribute of element.attrs) {
    if (
      attribute.namespaceUri === name.namespaceUri &&
      attribute.name === name.localName
    ) {
      return attribute.value;
    }
  }
  return undefined;
}

interface DirectText {
  readonly text: string;
  readonly mixed: boolean;
}

function directTextOf(element: XmlElement): DirectText {
  let text = "";
  let mixed = false;
  for (
    let child = firstChildOf(element);
    child !== undefined;
    child = nextSibling(child)
  ) {
    if (child instanceof XmlText || child instanceof XmlCData) {
      text += child.content;
    } else if (child instanceof XmlElement) {
      mixed = true;
    }
  }
  return { text, mixed };
}

function descend(
  element: XmlElement,
  steps: NodeAddress,
): XmlElement | undefined {
  let current = element;
  for (const step of steps) {
    let seen = 0;
    let found: XmlElement | undefined;
    for (
      let child = firstChildOf(current);
      child !== undefined;
      child = nextSibling(child)
    ) {
      if (
        child instanceof XmlElement &&
        sameName(step, {
          namespaceUri: child.namespaceUri,
          localName: child.name,
        })
      ) {
        seen += 1;
        if (seen === step.occurrence) {
          found = child;
          break;
        }
      }
    }
    if (found === undefined) return undefined;
    current = found;
  }
  return current;
}

function matchingChildren(
  element: XmlElement,
  name: ExpandedName,
  ceiling: number,
): readonly XmlElement[] {
  const found: XmlElement[] = [];
  for (
    let child = firstChildOf(element);
    child !== undefined;
    child = nextSibling(child)
  ) {
    if (
      child instanceof XmlElement &&
      sameName(name, {
        namespaceUri: child.namespaceUri,
        localName: child.name,
      })
    ) {
      found.push(child);
      if (found.length > ceiling) break;
    }
  }
  return found;
}

interface RawValue {
  readonly text: string;
  readonly mixed: boolean;
}

function valueFrom(
  element: XmlElement,
  column: ColumnSpec,
): RawValue | undefined {
  switch (column.source.from) {
    case "text": {
      const direct = directTextOf(element);
      return { text: direct.text, mixed: direct.mixed };
    }
    case "attribute": {
      const value = attributeValue(element, column.source.attribute);
      return value === undefined ? undefined : { text: value, mixed: false };
    }
    default:
      return { text: element.name, mixed: false };
  }
}

function presentCell(raw: RawValue, maxChars: number): Cell {
  const value = clampChars(raw.text, maxChars);
  const truncated =
    value.length === raw.text.length ? {} : { truncated: true as const };
  const mixed = raw.mixed ? { mixed: true as const } : {};
  return value === ""
    ? { status: "empty", ...mixed }
    : { status: "present", value, ...truncated, ...mixed };
}

export function cellOf(
  item: XmlElement,
  column: ColumnSpec,
  limits: ScanLimits,
): Cell {
  const host = descend(item, column.ancestors);
  if (host === undefined) return { status: "missing" };

  if (column.name === undefined) {
    const raw = valueFrom(host, column);
    return raw === undefined
      ? { status: "missing" }
      : presentCell(raw, limits.maxChars);
  }

  const found = matchingChildren(host, column.name, limits.maxCellValues);
  if (found.length === 0) return { status: "missing" };
  if (found.length === 1) {
    const only = found[0];
    if (only === undefined) return { status: "missing" };
    const raw = valueFrom(only, column);
    return raw === undefined
      ? { status: "missing" }
      : presentCell(raw, limits.maxChars);
  }

  if (column.onMultiple === "error") {
    return { status: "multiple", count: found.length };
  }
  if (column.onMultiple === "first") {
    const first = found[0];
    if (first === undefined) return { status: "missing" };
    const raw = valueFrom(first, column);
    return raw === undefined
      ? { status: "missing" }
      : presentCell(raw, limits.maxChars);
  }

  const values: string[] = [];
  let truncated = false;
  for (const candidate of found.slice(0, limits.maxCellValues)) {
    const raw = valueFrom(candidate, column);
    if (raw === undefined) continue;
    const value = clampChars(raw.text, limits.maxChars);
    if (value.length !== raw.text.length) truncated = true;
    values.push(value);
  }
  if (found.length > limits.maxCellValues) truncated = true;
  return {
    status: "list",
    values,
    count: found.length,
    ...(truncated ? { truncated: true as const } : {}),
  };
}

export function cellsOf(
  item: XmlElement,
  columns: readonly ColumnSpec[],
  limits: ScanLimits,
): readonly Cell[] {
  return columns.map((column) => cellOf(item, column, limits));
}

function comparableText(cell: Cell): string | undefined {
  if (cell.status === "present") return cell.value;
  if (cell.status === "empty") return "";
  return undefined;
}

function normalize(text: string, caseSensitive: boolean): string {
  return caseSensitive ? text : asciiLower(text);
}

function holds(
  cell: Cell,
  condition: Condition,
  caseSensitive: boolean,
): boolean {
  switch (condition.op) {
    case "isMissing":
      return cell.status === "missing";
    case "isPresent":
      return cell.status !== "missing";
    case "isEmpty":
      return cell.status === "empty";
    case "isNotEmpty":
      return cell.status !== "missing" && cell.status !== "empty";
    default:
      break;
  }

  const text = comparableText(cell);
  if (text === undefined) return false;
  const left = normalize(text, caseSensitive);

  if (condition.op === "in") {
    return (condition.values ?? []).some(
      (candidate) => normalize(candidate, caseSensitive) === left,
    );
  }

  const right = normalize(condition.value ?? "", caseSensitive);
  switch (condition.op) {
    case "eq":
      return left === right;
    case "ne":
      return left !== right;
    case "contains":
      return left.includes(right);
    case "startsWith":
      return left.startsWith(right);
    default:
      return left.endsWith(right);
  }
}

export function matchesWhere(
  cells: readonly Cell[],
  where: readonly Condition[],
  mode: MatchMode,
  caseSensitive: boolean,
): boolean {
  if (where.length === 0) return true;
  const results = where.map((condition) => {
    const cell = cells[condition.column];
    return cell === undefined ? false : holds(cell, condition, caseSensitive);
  });
  return mode === "all" ? results.every(Boolean) : results.some(Boolean);
}

export function emptyReports(columns: readonly ColumnSpec[]): ColumnReport[] {
  return columns.map((column) => ({
    label: column.label,
    missingCount: 0,
    emptyCount: 0,
    multipleCount: 0,
    mixedCount: 0,
  }));
}

export function countInto(
  reports: ColumnReport[],
  cells: readonly Cell[],
): void {
  cells.forEach((cell, index) => {
    const report = reports[index];
    if (report === undefined) return;
    const mixed = "mixed" in cell && cell.mixed === true ? 1 : 0;
    reports[index] = {
      label: report.label,
      missingCount: report.missingCount + (cell.status === "missing" ? 1 : 0),
      emptyCount: report.emptyCount + (cell.status === "empty" ? 1 : 0),
      multipleCount:
        report.multipleCount +
        (cell.status === "multiple" || cell.status === "list" ? 1 : 0),
      mixedCount: report.mixedCount + mixed,
    };
  });
}

export function projectRecords(
  root: XmlElement,
  probe: RecordProbe,
): RecordPage | undefined {
  const scan = scanItems(root, probe.item, probe.maxItemVisits);
  if (scan === undefined) return undefined;

  const reports = emptyReports(probe.columns);
  const rows: Row[] = [];
  let matched = 0;
  let next: number | undefined;

  for (const visit of scan.items) {
    let cells: readonly Cell[] | undefined;
    if (probe.where.length > 0) {
      cells = cellsOf(visit.element, probe.columns, probe);
      if (!matchesWhere(cells, probe.where, probe.match, probe.caseSensitive)) {
        continue;
      }
    }
    const index = matched;
    matched += 1;
    if (index < probe.offset) continue;
    if (rows.length >= probe.maxRows) {
      next ??= index;
      continue;
    }
    const resolved = cells ?? cellsOf(visit.element, probe.columns, probe);
    countInto(reports, resolved);
    rows.push({
      nodeId: formatNodeId(visit.path),
      occurrence: visit.occurrence,
      cells: resolved,
    });
  }

  return {
    rows,
    columns: reports,
    itemParentAddress: scan.parentAddress,
    itemName: probe.item.name,
    scannedItems: scan.scanned,
    matchedItems: matched,
    totalItems: scan.items.length,
    totalItemsExact: scan.complete,
    complete: scan.complete,
    ...(next === undefined ? {} : { next }),
  };
}

export function groupKeyOf(cells: readonly Cell[]): string {
  return cells
    .map((cell) => {
      if (cell.status === "present") {
        return `p${String(cell.value.length)}:${cell.value}`;
      }
      if (cell.status === "empty") return "e";
      if (cell.status === "missing") return "m";
      if (cell.status === "multiple") return `x${String(cell.count)}`;
      const parts = cell.values.map(
        (value) => `${String(value.length)}:${value}`,
      );
      return `l${String(cell.count)}:${parts.join("")}`;
    })
    .join("");
}

/**
 * Parses and disposes one fragment before starting the next. Holding two would
 * break the `maxLiveChunkDoms * maxChunkBytes <= residentMaxBytes` bound that
 * policy.spec.ts pins.
 */
export function projectChunks(
  fragments: readonly Uint8Array[],
  firstOccurrence: number,
  probe: ChunkProbe,
): ChunkPage {
  const rows: Row[] = [];
  let matched = 0;
  for (const [index, fragment] of fragments.entries()) {
    const document = XmlDocument.fromBuffer(Buffer.from(fragment), {
      option: HARDENED,
    });
    try {
      if (document.dtd !== null) throw new Error("doctype_not_allowed");
      let child = firstChildOf(document.root);
      while (child !== undefined && !(child instanceof XmlElement))
        child = nextSibling(child);
      if (!(child instanceof XmlElement))
        throw new Error("the fragment carried no record element");
      const cells = cellsOf(child, probe.columns, probe);
      if (
        probe.where.length > 0 &&
        !matchesWhere(cells, probe.where, probe.match, probe.caseSensitive)
      )
        continue;
      matched += 1;
      rows.push({ occurrence: firstOccurrence + index, cells });
    } finally {
      document.dispose();
    }
  }
  return { rows, scanned: fragments.length, matched };
}
