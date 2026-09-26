import { mcpCoreLimits } from "@liaiso/mcp-core";

export const coreLimits = {
  ...mcpCoreLimits,
  maxFileBytes: 50 * 1024 * 1024,
  maxListResults: 200,
  defaultListResults: 50,
  maxListScan: 5_000,
  documentCacheSize: 4,
} as const;

export type CoreLimits = typeof coreLimits;
