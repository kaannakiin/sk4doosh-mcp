import {
  asciiLower,
  asciiUpper,
  sqlText,
  type GuardOutcome,
} from "@sk-mcp/db-core";

/**
 * Keywords that make a statement do something other than read. `into` is here
 * because `SELECT ... INTO #t` creates a table, which no `INSERT` check would
 * catch; `waitfor` because it holds a connection for an arbitrary time.
 */
const forbidden = [
  "insert",
  "update",
  "delete",
  "merge",
  "drop",
  "alter",
  "create",
  "truncate",
  "exec",
  "execute",
  "grant",
  "revoke",
  "deny",
  "backup",
  "restore",
  "shutdown",
  "reconfigure",
  "waitfor",
  "into",
  "openquery",
  "openrowset",
  "opendatasource",
  "bulk",
];

const procedurePrefix = /\b(?:sp_|xp_)\w*/u;

interface Normalised {
  readonly masked: string;
  readonly statements: readonly string[];
}

/**
 * Guard: comments and literals are removed before any keyword is looked for. A
 * plain regex over the raw text both refuses `select 'drop me' as note` and
 * accepts a statement that hides `drop table t` behind a block comment, so
 * masking is what makes the check mean anything. Bracketed identifiers collapse
 * too, so a column named `[delete]` stays legal.
 */
function normalise(sql: string): Normalised {
  let masked = "";
  let index = 0;
  while (index < sql.length) {
    const here = sql[index];
    const next = sql[index + 1];
    if (here === "'") {
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === "'") {
          if (sql[end + 1] === "'") {
            end += 2;
            continue;
          }
          break;
        }
        end += 1;
      }
      masked += "''";
      index = end + 1;
      continue;
    }
    if (here === "[") {
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === "]") {
          if (sql[end + 1] === "]") {
            end += 2;
            continue;
          }
          break;
        }
        end += 1;
      }
      masked += "id";
      index = end + 1;
      continue;
    }
    if (here === '"') {
      let end = index + 1;
      while (end < sql.length && sql[end] !== '"') {
        end += 1;
      }
      masked += "id";
      index = end + 1;
      continue;
    }
    if (here === "-" && next === "-") {
      while (index < sql.length && sql[index] !== "\n") {
        index += 1;
      }
      masked += " ";
      continue;
    }
    if (here === "/" && next === "*") {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth > 0) {
        if (sql[index] === "/" && sql[index + 1] === "*") {
          depth += 1;
          index += 2;
          continue;
        }
        if (sql[index] === "*" && sql[index + 1] === "/") {
          depth -= 1;
          index += 2;
          continue;
        }
        index += 1;
      }
      masked += " ";
      continue;
    }
    masked += here;
    index += 1;
  }
  const statements = masked
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return { masked: asciiLower(masked), statements };
}

const refuse = (reason: string, recovery: string): GuardOutcome => ({
  verdict: "refuse",
  reason,
  recovery,
});

/**
 * Decides whether one statement may run.
 *
 * Guard: advisory. The security boundary is the database principal — this check
 * exists so a write attempt returns a legible refusal instead of a driver
 * permission error, and so a typo cannot run a batch. Its `allow` arm is
 * nonetheless the only place agent text becomes `SqlText`.
 */
export function readOnlyGuard(sql: string): GuardOutcome {
  const { masked, statements } = normalise(sql);
  if (statements.length === 0) {
    return refuse(
      "The statement is empty once comments are removed.",
      "Send one SELECT statement.",
    );
  }
  if (statements.length > 1) {
    return refuse(
      `The text carries ${statements.length} statements; only one is allowed.`,
      "Send a single SELECT statement, with no semicolon-separated batch.",
    );
  }
  const first = /^\s*(\w+)/u.exec(masked)?.[1];
  if (first !== "select" && first !== "with") {
    return refuse(
      `A read-only statement has to begin with SELECT or WITH; this one begins with ${first ?? "nothing"}.`,
      "Rewrite the request as a SELECT.",
    );
  }
  const hit = forbidden.find((word) =>
    new RegExp(`\\b${word}\\b`, "u").test(masked),
  );
  if (hit !== undefined) {
    return refuse(
      `The statement carries the keyword ${asciiUpper(hit)}, which is not read-only.`,
      "Remove it, or ask for the data with a plain SELECT.",
    );
  }
  if (procedurePrefix.test(masked)) {
    return refuse(
      "The statement names a system procedure.",
      "Use list_tables and describe_table for catalogue questions.",
    );
  }
  return { verdict: "allow", statement: sqlText(sql) };
}
