import { sqlText, type Dialect, type QuerySpec } from "@sk-mcp/db-core";
import type { MssqlConfig } from "../platform/env.js";
import { secretPatterns } from "../platform/errors.js";
import { limits } from "../platform/limits.js";
import { mapDriverError } from "./errors.js";
import { readOnlyGuard } from "./guard.js";
import { createIntrospection } from "./introspect.js";
import { quoteIdentifier, quoteQualified } from "./quote.js";
import { classify } from "./types.js";

/**
 * Guard: `lock_timeout` is what stops a read from waiting behind a writer
 * forever — a reporting connection has no business holding a call open until the
 * server gives up. `nocount` keeps row-count chatter out of the result stream.
 * Neither changes what a statement reads.
 */
const sessionStatements = (timeoutMs: number): readonly QuerySpec[] => [
  {
    sql: sqlText(`set nocount on; set lock_timeout ${timeoutMs};`),
    parameters: [],
    timeoutMs,
    maxRows: 0,
  },
];

export const mssqlDialect = {
  id: "mssql",
  secretPatterns,
  sessionSetup: () => sessionStatements(limits.queryTimeoutMs),
  /**
   * Guard: MSSQL has no equivalent of a read-only session default.
   * `ApplicationIntent=ReadOnly` only routes to a readable secondary inside an
   * availability group and guarantees nothing on a standalone instance, so
   * claiming one here would be a lie the agent cannot check. The guarantee is
   * the database principal.
   */
  sessionIntent: () => "none" as const,
  quoteIdentifier,
  quoteQualified,
  classify,
  introspection: createIntrospection(
    limits.queryTimeoutMs,
    limits.maxListResults,
  ),
  mapDriverError,
  readOnlyGuard,
} as const satisfies Dialect<MssqlConfig>;
