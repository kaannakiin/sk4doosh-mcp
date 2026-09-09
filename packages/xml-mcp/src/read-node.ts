import {
  createPageBudget,
  measureJson,
  type Fingerprint,
} from "@sk-mcp/file-core";
import { cursorTtlMs, encodePosition } from "./cursor.js";
import { SkMcpXmlError } from "./errors.js";
import { limits } from "./limits.js";
import {
  parseNodeId,
  type ContextRecord,
  type NodeAddress,
  type NodePath,
  type NodeRecord,
} from "./node-model.js";
import type { ReadPage } from "./worker-protocol.js";

const cursorSlackBytes = 32;

export type ReadTruncation = "maxNodes" | "maxPayloadBytes";

export interface ReadEnvelope {
  readonly filePath: string;
  readonly snapshotId: string;
  readonly scopeAddress: NodeAddress;
  readonly records: readonly NodeRecord[];
  readonly context?: readonly ContextRecord[];
  readonly returnedCount: number;
  readonly complete: boolean;
  readonly truncated: boolean;
  readonly truncationReason?: ReadTruncation;
  readonly nextCursor?: string;
  readonly hint?: string;
}

export interface AssembleInput {
  readonly filePath: string;
  readonly snapshotId: Fingerprint;
  readonly optionsHash: string;
  readonly page: ReadPage;
}

function deepestPath(page: ReadPage): NodePath {
  let deepest: NodePath = page.scopePath;
  for (const record of page.records) {
    const path = parseNodeId(record.nodeId);
    if (path !== undefined && path.length > deepest.length) deepest = path;
  }
  return [...deepest, 1, 1];
}

const hint =
  "More nodes remain in this view. Pass nextCursor to continue, or narrow the read with address and maxDepth.";

export function assemblePage(input: AssembleInput): ReadEnvelope {
  const { page, snapshotId, optionsHash } = input;
  const cursorAt = (position: NodePath): string =>
    encodePosition(snapshotId, {
      t: "read",
      p: position,
      s: page.scopePath,
      o: optionsHash,
      x: Date.now() + cursorTtlMs,
    });

  const context = page.context ?? [];
  const reserveBytes =
    measureJson({
      filePath: input.filePath,
      snapshotId,
      scopeAddress: page.scopeAddress,
      records: [],
      ...(context.length === 0 ? {} : { context }),
      returnedCount: page.records.length,
      complete: false,
      truncated: true,
      truncationReason: "maxPayloadBytes",
      nextCursor: cursorAt(deepestPath(page)),
      hint,
    }) + cursorSlackBytes;

  const budget = createPageBudget({
    maxBytes: limits.maxPayloadBytes,
    reserveBytes,
  });

  const admitted: NodeRecord[] = [];
  let refusedAt: NodePath | undefined;

  for (const record of page.records) {
    if (budget.admit(record)) {
      admitted.push(record);
      continue;
    }
    refusedAt = parseNodeId(record.nodeId);
    break;
  }

  if (admitted.length === 0) {
    throw new SkMcpXmlError(
      "resource_limit",
      `The first node of the requested view does not fit in the ${String(limits.maxPayloadBytes)} byte response budget.`,
      "Read a narrower view with address and maxDepth, or use find_in_document to locate a value.",
    );
  }

  const nextPath = refusedAt ?? page.next;
  const truncationReason: ReadTruncation | undefined =
    refusedAt !== undefined
      ? "maxPayloadBytes"
      : page.next === undefined
        ? undefined
        : "maxNodes";

  return {
    filePath: input.filePath,
    snapshotId,
    scopeAddress: page.scopeAddress,
    records: admitted,
    ...(context.length === 0 ? {} : { context }),
    returnedCount: admitted.length,
    complete: nextPath === undefined,
    truncated: nextPath !== undefined,
    ...(truncationReason === undefined ? {} : { truncationReason }),
    ...(nextPath === undefined ? {} : { nextCursor: cursorAt(nextPath), hint }),
  };
}
