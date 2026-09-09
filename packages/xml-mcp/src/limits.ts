import { coreLimits } from "@sk-mcp/file-core";

/**
 * The worker keeps a document alive while the store still holds it, so its map
 * must fit every store entry plus the one being adopted: W >= 2S-1. Exposing S
 * alone and deriving W keeps the pair from drifting apart; limits.spec.ts pins
 * the inequality.
 */
export function workerCapacityFor(documentCacheSize: number): number {
  return documentCacheSize * 2;
}

export const limits = {
  ...coreLimits,
  maxXmlBytes: 8 * 1024 * 1024,
  maxParseMs: 2_000,
  maxQueueDepth: 5,
  maxDomDepth: 128,
  workerCacheEntries: workerCapacityFor(coreLimits.documentCacheSize),
  prologScanBytes: 64 * 1024,
  defaultReadNodes: 50,
  maxReadNodes: 200,
  defaultFindResults: 50,
  maxFindResults: 200,
  maxFindVisits: 50_000,
  defaultDescribePaths: 20,
  maxDescribePaths: 200,
  maxDescribeVisits: 5_000,
  maxConcurrentListings: 4,
} as const;
