import { dbCoreLimits } from "@sk-mcp/db-core";

export const limits = {
  ...dbCoreLimits,
  /**
   * Guard: measured, not chosen — `request.timeout` does not interrupt a running
   * statement on this driver (docs/db-surucu-spike.md §2), so the deadline is a
   * timer that aborts the signal. It is set below the connect timeout so a
   * blocked query cannot outlive the call that asked for it.
   */
  queryTimeoutMs: 30_000,
  maxConnections: 4,
} as const;
