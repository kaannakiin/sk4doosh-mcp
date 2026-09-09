import { coreLimits } from "@sk-mcp/file-core";

export const limits = {
  ...coreLimits,
  maxXmlBytes: 8 * 1024 * 1024,
  maxParseMs: 2_000,
  maxQueueDepth: 5,
  maxDomDepth: 128,
  workerCacheEntries: 8,
  prologScanBytes: 64 * 1024,
} as const;
