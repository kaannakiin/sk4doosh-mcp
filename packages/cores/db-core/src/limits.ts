import { mcpCoreLimits } from "@sk-mcp/mcp-core";

export const dbCoreLimits = {
  ...mcpCoreLimits,
  maxRows: 1_000,
  defaultRows: 100,
  maxColumns: 512,
  maxKeys: 256,
  maxTextChars: 4_096,
  maxBinaryBytes: 4_096,
  maxListResults: 200,
  maxIndexObjects: 5_000,
  maxIndexRows: 50_000,
  maxDescriptionChars: 160,
  catalogIndexTtlMs: 15 * 60_000,
  maxQueryTerms: 16,
  maxExpansions: 32,
  maxMatchReasons: 8,
  defaultListResults: 50,
  queryTimeoutMs: 30_000,
  maxConnections: 4,
  maxQueueDepth: 32,
  connectTimeoutMs: 15_000,
  idleTimeoutMs: 60_000,
  /**
   * Guard: how long a cancelled request may take to settle before its
   * connection is destroyed instead of returned to the pool. A cancel that
   * never settles then costs one connection, never a crossed result set.
   */
  cancelSettleMs: 5_000,
} as const;

/**
 * Guard: widened to `number`, not `typeof dbCoreLimits`. The literal type made
 * every field assignable only to the value it already had, so a product could
 * name an override but never actually change one — and a test could not narrow
 * a limit to reach the path that limit guards.
 */
export type DbLimits = Readonly<Record<keyof typeof dbCoreLimits, number>>;
