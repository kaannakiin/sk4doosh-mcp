import type { DbErrorCode, DriverFailure } from "@sk-mcp/db-core";

interface RequestErrorShape {
  readonly code?: unknown;
  readonly number?: unknown;
  readonly message?: unknown;
}

/**
 * Guard: the driver reports two different things in two different fields. A
 * connection-level fault carries a string `code` (`ECANCEL`, `ELOGIN`), while a
 * server-side fault carries `code: "EREQUEST"` and the real reason in the
 * numeric `number`. Reading only one of them misclassifies half the failures.
 * The numbers below are measured in docs/db-surucu-spike.md §6.
 */
const byNumber: Readonly<Record<number, DbErrorCode>> = {
  208: "object_not_found",
  2812: "invalid_argument",
  229: "permission_denied",
  230: "permission_denied",
  262: "permission_denied",
  297: "permission_denied",
  916: "permission_denied",
  1205: "deadlock",
  8134: "invalid_argument",
  102: "invalid_argument",
  156: "invalid_argument",
  207: "invalid_argument",
  4145: "invalid_argument",
};

const byCode: Readonly<Record<string, DbErrorCode>> = {
  ECANCEL: "query_cancelled",
  ETIMEOUT: "query_timeout",
  ELOGIN: "authentication_failed",
  ESOCKET: "connection_failed",
  ECONNCLOSED: "connection_failed",
  ENOTOPEN: "connection_failed",
  ENOCONN: "connection_failed",
  EINSTLOOKUP: "connection_failed",
};

const recoveries: Partial<Record<DbErrorCode, string>> = {
  object_not_found: "Call list_tables for the names this connection can read.",
  permission_denied:
    "The connected principal cannot read that object; ask for one list_tables returns.",
  deadlock: "The call was chosen as a deadlock victim; retrying may succeed.",
  invalid_argument: "Correct the statement and call again.",
  authentication_failed:
    "This is a server configuration problem, not something the call can fix.",
  connection_failed:
    "The database was not reachable; retrying may succeed once it is.",
};

export function mapDriverError(error: unknown): DriverFailure | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const shape = error as RequestErrorShape;
  const message =
    typeof shape.message === "string" ? shape.message : "The query failed.";
  const code = typeof shape.code === "string" ? shape.code : undefined;

  if (code === "EREQUEST") {
    const number = typeof shape.number === "number" ? shape.number : undefined;
    const mapped =
      number === undefined
        ? "query_failed"
        : (byNumber[number] ?? "query_failed");
    return {
      code: mapped,
      message,
      ...(number === undefined ? {} : { engineCode: number }),
      ...(recoveries[mapped] === undefined
        ? {}
        : { recovery: recoveries[mapped] }),
    };
  }

  if (code !== undefined && byCode[code] !== undefined) {
    const mapped = byCode[code];
    return {
      code: mapped,
      message,
      engineCode: code,
      ...(recoveries[mapped] === undefined
        ? {}
        : { recovery: recoveries[mapped] }),
    };
  }

  return undefined;
}
