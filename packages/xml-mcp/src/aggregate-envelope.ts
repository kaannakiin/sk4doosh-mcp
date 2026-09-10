import {
  createPageBudget,
  measureJson,
  type Fingerprint,
  type SourceMode,
} from "@sk-mcp/file-core";
import { SkMcpXmlError } from "./errors.js";
import { limits } from "./limits.js";
import type { ExpandedName, NodeAddress } from "./node-model.js";
import type {
  AggregateOutcome,
  ColumnReport,
  GroupResult,
  MetricFunction,
  NumericMode,
} from "./query-model.js";

export interface MetricEcho {
  readonly fn: MetricFunction;
  readonly column?: string;
}

export type AggregateTruncation =
  "maxGroups" | "maxPayloadBytes" | "scanBudget";

export interface AggregateEnvelope {
  readonly filePath: string;
  readonly snapshotId: string;
  readonly mode: SourceMode;
  readonly itemParentAddress: NodeAddress;
  readonly itemName: ExpandedName;
  readonly numericMode: NumericMode;
  readonly metrics: readonly MetricEcho[];
  readonly columns: readonly ColumnReport[];
  readonly groups: readonly GroupResult[];
  readonly groupCount: number;
  readonly returnedGroups: number;
  readonly matchedItems: number;
  readonly returnedMatchedItems: number;
  readonly scannedItems: number;
  readonly totalItems: number;
  readonly totalItemsExact: boolean;
  readonly complete: boolean;
  readonly truncated: boolean;
  readonly truncationReason?: AggregateTruncation;
  readonly hint?: string;
}

export interface AssembleAggregateInput {
  readonly filePath: string;
  readonly snapshotId: Fingerprint;
  readonly mode: SourceMode;
  readonly numericMode: NumericMode;
  readonly metrics: readonly MetricEcho[];
  readonly outcome: AggregateOutcome;
}

const hint =
  "Not every group is in this response. groupCount and matchedItems cover the whole scan; each metric's counted and skipped cover the returned groups only.";

export function assembleAggregate(
  input: AssembleAggregateInput,
): AggregateEnvelope {
  const { outcome, snapshotId } = input;
  const head = {
    filePath: input.filePath,
    snapshotId,
    mode: input.mode,
    itemParentAddress: outcome.itemParentAddress,
    itemName: outcome.itemName,
    numericMode: input.numericMode,
    metrics: input.metrics,
    columns: outcome.columns,
  };

  const reserveBytes = measureJson({
    ...head,
    groups: [],
    groupCount: outcome.groupCount,
    returnedGroups: outcome.groups.length,
    matchedItems: outcome.matchedItems,
    returnedMatchedItems: outcome.returnedMatchedItems,
    scannedItems: outcome.scannedItems,
    totalItems: outcome.totalItems,
    totalItemsExact: outcome.totalItemsExact,
    complete: false,
    truncated: true,
    truncationReason: "maxPayloadBytes",
    hint,
  });

  const budget = createPageBudget({
    maxBytes: limits.maxPayloadBytes,
    reserveBytes,
  });

  const admitted: GroupResult[] = [];
  let refused = false;
  for (const group of outcome.groups) {
    if (budget.admit(group)) {
      admitted.push(group);
      continue;
    }
    refused = true;
    break;
  }

  if (admitted.length === 0 && outcome.groups.length > 0) {
    throw new SkMcpXmlError(
      "resource_limit",
      `The first group does not fit in the ${String(limits.maxPayloadBytes)} byte response budget.`,
      "Group by fewer columns, or ask for fewer metrics.",
    );
  }

  const returnedMatchedItems = admitted.reduce(
    (total, group) => total + group.rows,
    0,
  );
  const complete = outcome.complete && !outcome.groupsTruncated && !refused;
  const truncationReason: AggregateTruncation | undefined = complete
    ? undefined
    : refused
      ? "maxPayloadBytes"
      : outcome.groupsTruncated
        ? "maxGroups"
        : "scanBudget";

  return {
    ...head,
    groups: admitted,
    groupCount: outcome.groupCount,
    returnedGroups: admitted.length,
    matchedItems: outcome.matchedItems,
    returnedMatchedItems,
    scannedItems: outcome.scannedItems,
    totalItems: outcome.totalItems,
    totalItemsExact: outcome.totalItemsExact,
    complete,
    truncated: !complete,
    ...(truncationReason === undefined ? {} : { truncationReason }),
    ...(complete ? {} : { hint }),
  };
}
