import {
  createPageBudget,
  measureJson,
  type Fingerprint,
  type SourceMode,
} from "@sk-mcp/file-core";
import { cursorTtlMs, encodePosition } from "./cursor.js";
import { SkMcpXmlError } from "./errors.js";
import type { FindMatch, FindPage } from "./find-model.js";
import { limits } from "./limits.js";
import { parseNodeId, type NodeAddress, type NodePath } from "./node-model.js";

const cursorSlackBytes = 32;

export type FindTruncation = "maxResults" | "maxPayloadBytes" | "scanBudget";

export interface FindEnvelope {
  readonly filePath: string;
  readonly snapshotId: string;
  readonly mode: SourceMode;
  readonly scopeAddress: NodeAddress;
  readonly matches: readonly FindMatch[];
  readonly returnedCount: number;
  readonly scannedCount: number;
  readonly complete: boolean;
  readonly totalMatches?: number;
  readonly matchedSoFar?: number;
  readonly truncated: boolean;
  readonly truncationReason?: FindTruncation;
  readonly nextCursor?: string;
  readonly hint?: string;
}

export interface AssembleFindInput {
  readonly filePath: string;
  readonly snapshotId: Fingerprint;
  readonly mode: SourceMode;
  readonly optionsHash: string;
  readonly page: FindPage;
  readonly maxResults: number;
}

const hint =
  "The scan stopped before the end of the document. Pass nextCursor to continue, or narrow it with scopeAddress.";

export function assembleFindPage(input: AssembleFindInput): FindEnvelope {
  const { page, snapshotId, optionsHash } = input;
  const cursorAt = (position: NodePath): string =>
    encodePosition(snapshotId, {
      t: "find",
      p: position,
      s: page.scopePath,
      o: optionsHash,
      x: Date.now() + cursorTtlMs,
    });

  const sampleCursor =
    page.next === undefined ? undefined : cursorAt(page.next);
  const reserveBytes =
    measureJson({
      filePath: input.filePath,
      snapshotId,
      mode: input.mode,
      scopeAddress: page.scopeAddress,
      matches: [],
      returnedCount: page.matches.length,
      scannedCount: page.scannedCount,
      complete: false,
      matchedSoFar: page.matches.length,
      truncated: true,
      truncationReason: "maxPayloadBytes",
      ...(sampleCursor === undefined ? {} : { nextCursor: sampleCursor, hint }),
    }) + cursorSlackBytes;

  const budget = createPageBudget({
    maxBytes: limits.maxPayloadBytes,
    reserveBytes,
  });

  const admitted: FindMatch[] = [];
  let refusedId: string | undefined;
  for (const match of page.matches) {
    if (budget.admit(match)) {
      admitted.push(match);
      continue;
    }
    refusedId = match.nodeId;
    break;
  }

  /**
   * One node can produce several matches (an element with two matching
   * attributes). Resuming re-scans the boundary node from the start, so every
   * match it already produced has to leave this page or the continuation
   * duplicates them.
   */
  if (refusedId !== undefined) {
    while (
      admitted.length > 0 &&
      admitted[admitted.length - 1]?.nodeId === refusedId
    ) {
      admitted.pop();
    }
  }

  if (admitted.length === 0 && page.matches.length > 0) {
    throw new SkMcpXmlError(
      "resource_limit",
      `The first match does not fit in the ${String(limits.maxPayloadBytes)} byte response budget.`,
      "Narrow the search with scopeAddress, or search for a shorter query.",
    );
  }

  const refusedPath =
    refusedId === undefined ? undefined : parseNodeId(refusedId);
  const complete = page.complete && refusedId === undefined;
  const truncationReason: FindTruncation | undefined =
    refusedId !== undefined
      ? "maxPayloadBytes"
      : page.complete
        ? undefined
        : page.matches.length >= input.maxResults
          ? "maxResults"
          : "scanBudget";

  const nextPath = refusedPath ?? page.next;

  return {
    filePath: input.filePath,
    snapshotId,
    mode: input.mode,
    scopeAddress: page.scopeAddress,
    matches: admitted,
    returnedCount: admitted.length,
    scannedCount: page.scannedCount,
    complete,
    ...(complete
      ? { totalMatches: admitted.length }
      : { matchedSoFar: admitted.length }),
    truncated: !complete,
    ...(truncationReason === undefined ? {} : { truncationReason }),
    ...(nextPath === undefined ? {} : { nextCursor: cursorAt(nextPath), hint }),
  };
}
