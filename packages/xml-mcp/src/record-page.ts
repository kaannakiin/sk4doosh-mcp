import {
  createPageBudget,
  measureJson,
  type Fingerprint,
  type SourceMode,
} from "@sk-mcp/file-core";
import { cursorTtlMs, encodePosition } from "./cursor.js";
import { SkMcpXmlError } from "./errors.js";
import { limits } from "./limits.js";
import type { ExpandedName, NodeAddress } from "./node-model.js";
import type { ColumnReport, RecordPage, Row } from "./query-model.js";

const cursorSlackBytes = 32;

export type RecordTruncation = "maxRows" | "maxPayloadBytes" | "scanBudget";

export interface RecordEnvelope {
  readonly filePath: string;
  readonly snapshotId: string;
  readonly mode: SourceMode;
  readonly itemParentAddress: NodeAddress;
  readonly itemName: ExpandedName;
  readonly columns: readonly ColumnReport[];
  readonly rows: readonly Row[];
  readonly returnedRows: number;
  readonly matchedItems: number;
  readonly scannedItems: number;
  readonly totalItems: number;
  readonly totalItemsExact: boolean;
  readonly complete: boolean;
  readonly truncated: boolean;
  readonly truncationReason?: RecordTruncation;
  readonly nextCursor?: string;
  readonly hint?: string;
}

export interface AssembleRecordInput {
  readonly filePath: string;
  readonly snapshotId: Fingerprint;
  readonly mode: SourceMode;
  readonly optionsHash: string;
  readonly offset: number;
  readonly page: RecordPage;
  readonly resumeBytes?: ReadonlyMap<number, number>;
}

const hint =
  "More rows match. Pass nextCursor to continue; each row's canonical address is itemParentAddress plus itemName at the row's occurrence.";

export function assembleRecordPage(input: AssembleRecordInput): RecordEnvelope {
  const { page, snapshotId } = input;
  const cursorAt = (position: number): string => {
    const byte = input.resumeBytes?.get(position);
    return encodePosition(snapshotId, {
      t: "records",
      i: position,
      ...(byte === undefined ? {} : { b: byte }),
      o: input.optionsHash,
      x: Date.now() + cursorTtlMs,
    });
  };

  const reserveBytes =
    measureJson({
      filePath: input.filePath,
      snapshotId,
      mode: input.mode,
      itemParentAddress: page.itemParentAddress,
      itemName: page.itemName,
      columns: page.columns,
      rows: [],
      returnedRows: page.rows.length,
      matchedItems: page.matchedItems,
      scannedItems: page.scannedItems,
      totalItems: page.totalItems,
      totalItemsExact: page.totalItemsExact,
      complete: false,
      truncated: true,
      truncationReason: "maxPayloadBytes",
      nextCursor: cursorAt(input.offset + page.rows.length),
      hint,
    }) + cursorSlackBytes;

  const budget = createPageBudget({
    maxBytes: limits.maxPayloadBytes,
    reserveBytes,
  });

  const admitted: Row[] = [];
  let refused = false;
  for (const row of page.rows) {
    if (budget.admit(row)) {
      admitted.push(row);
      continue;
    }
    refused = true;
    break;
  }

  if (admitted.length === 0 && page.rows.length > 0) {
    throw new SkMcpXmlError(
      "resource_limit",
      `The first row does not fit in the ${String(limits.maxPayloadBytes)} byte response budget.`,
      "Ask for fewer columns, or read the record with read_node instead.",
    );
  }

  const consumed = input.offset + admitted.length;
  const complete = page.complete && !refused && consumed >= page.matchedItems;
  const truncationReason: RecordTruncation | undefined = complete
    ? undefined
    : refused
      ? "maxPayloadBytes"
      : consumed < page.matchedItems
        ? "maxRows"
        : "scanBudget";

  return {
    filePath: input.filePath,
    snapshotId,
    mode: input.mode,
    itemParentAddress: page.itemParentAddress,
    itemName: page.itemName,
    columns: page.columns,
    rows: admitted,
    returnedRows: admitted.length,
    matchedItems: page.matchedItems,
    scannedItems: page.scannedItems,
    totalItems: page.totalItems,
    totalItemsExact: page.totalItemsExact,
    complete,
    truncated: !complete,
    ...(truncationReason === undefined ? {} : { truncationReason }),
    ...(complete ? {} : { nextCursor: cursorAt(consumed), hint }),
  };
}
