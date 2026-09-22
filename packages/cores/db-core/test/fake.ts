import type {
  ColumnDescriptor,
  Dialect,
  DriverAdapter,
  DriverConnection,
  QueryResult,
  QuerySpec,
  RunningQuery,
} from "../src/index.js";
import { DbSourceError, quotedIdentifier, sqlText } from "../src/index.js";
import type { ErrorFactory } from "@sk-mcp/mcp-core";
import type { DbErrorCode } from "../src/errors.js";

export interface FakeConfig {
  readonly host: string;
  readonly password: string;
}

export const fail: ErrorFactory<DbErrorCode> = (code, message, recovery) =>
  new DbSourceError(code, message, recovery);

export const column = (
  name: string,
  ordinal: number,
  kind: ColumnDescriptor["kind"] = "text",
): ColumnDescriptor => ({
  name,
  ordinal,
  kind,
  nativeType: kind,
  nullable: true,
});

export type Script =
  | {
      readonly kind: "rows";
      readonly columns: readonly ColumnDescriptor[];
      readonly rows: readonly (readonly unknown[])[];
      readonly more?: boolean;
    }
  | { readonly kind: "throw"; readonly error: unknown }
  | { readonly kind: "hang" };

export const rows = (
  columns: readonly ColumnDescriptor[],
  values: readonly (readonly unknown[])[],
  more = false,
): Script => ({ kind: "rows", columns, rows: values, more });

export interface FakeDriver {
  readonly adapter: DriverAdapter<FakeConfig>;
  readonly stats: {
    opened: number;
    destroyed: number;
    cancels: number;
    ran: QuerySpec[];
  };
}

export interface FakeDriverOptions {
  respond(spec: QuerySpec): Script;
  /**
   * When false a cancelled request never settles, which is what exercises the
   * `cancelSettleMs` quarantine path.
   */
  readonly settleOnCancel?: boolean;
  readonly broken?: (error: unknown) => boolean;
  readonly openError?: () => unknown;
}

export function createFakeDriver(options: FakeDriverOptions): FakeDriver {
  const stats = { opened: 0, destroyed: 0, cancels: 0, ran: [] as QuerySpec[] };
  let nextId = 0;

  const adapter: DriverAdapter<FakeConfig> = {
    open: async () => {
      const thrown = options.openError?.();
      if (thrown !== undefined) {
        throw thrown;
      }
      stats.opened += 1;
      nextId += 1;
      const connection: DriverConnection = {
        id: nextId,
        destroy: async () => {
          stats.destroyed += 1;
        },
        run: (spec: QuerySpec): RunningQuery => {
          stats.ran.push(spec);
          const script = options.respond(spec);
          if (script.kind === "throw") {
            return {
              settled: Promise.reject(script.error),
              cancel: () => {
                stats.cancels += 1;
              },
            };
          }
          if (script.kind === "rows") {
            const result: QueryResult = {
              columns: script.columns,
              rows: script.rows,
              more: script.more ?? false,
            };
            return {
              settled: Promise.resolve(result),
              cancel: () => {
                stats.cancels += 1;
              },
            };
          }
          let settle: ((value: QueryResult) => void) | undefined;
          const settled = new Promise<QueryResult>((resolve) => {
            settle = resolve;
          });
          return {
            settled,
            cancel: () => {
              stats.cancels += 1;
              if (options.settleOnCancel !== false) {
                settle?.({ columns: [], rows: [], more: false });
              }
            },
          };
        },
      };
      return connection;
    },
    isBroken: (error) => options.broken?.(error) ?? false,
  };

  return { adapter, stats };
}

const spec = (text: string): QuerySpec => ({
  sql: sqlText(text),
  parameters: [],
  timeoutMs: 1_000,
  maxRows: 100,
});

export function createFakeDialect(): Dialect<FakeConfig> {
  return {
    id: "fake",
    secretPatterns: [/(\bhost\s*=\s*)\S+/gi],
    sessionSetup: () => [],
    sessionIntent: () => "none",
    quoteIdentifier: (name, failure) => {
      if (name.includes("\u0000")) {
        throw failure("invalid_argument", "An identifier carries a NUL byte.");
      }
      return quotedIdentifier(`"${name.replaceAll('"', '""')}"`);
    },
    quoteQualified: (ref) => quotedIdentifier(`"${ref.schema}"."${ref.name}"`),
    describeType: (native) => ({
      kind:
        native.typeName === "int"
          ? "integer"
          : native.typeName === "big"
            ? "bigint"
            : "text",
    }),
    introspection: {
      server: () => ({
        spec: spec("server"),
        project: (row) => ({
          engineVersion: String(row["engineVersion"] ?? ""),
          catalog: String(row["catalog"] ?? ""),
          principal: String(row["principal"] ?? ""),
        }),
      }),
      tables: () => ({
        spec: spec("tables"),
        project: (row) => ({
          schema: String(row["schema"] ?? ""),
          name: String(row["name"] ?? ""),
          kind: row["kind"] === "view" ? "view" : "table",
        }),
      }),
      columns: () => ({
        spec: spec("columns"),
        project: (row) => ({
          name: String(row["name"] ?? ""),
          ordinal: Number(row["ordinal"] ?? 0),
          kind: "text",
          nativeType: String(row["nativeType"] ?? "text"),
          nullable: row["nullable"] !== false,
        }),
      }),
      keys: () => ({
        spec: spec("keys"),
        project: (row) => ({
          name: String(row["name"] ?? ""),
          kind:
            row["kind"] === "primary"
              ? "primary"
              : row["kind"] === "foreign"
                ? "foreign"
                : "unique",
          columns: Array.isArray(row["columns"])
            ? (row["columns"] as string[])
            : [],
        }),
      }),
    },
    mapDriverError: (error) =>
      error instanceof Error && error.message.startsWith("login")
        ? {
            code: "authentication_failed",
            message: error.message,
            engineCode: 18456,
          }
        : undefined,
    readOnlyGuard: (sql) =>
      /^\s*(select|with)\b/i.test(sql) && !sql.includes(";")
        ? { verdict: "allow", statement: sqlText(sql) }
        : {
            verdict: "refuse",
            reason: "Only a single SELECT is allowed.",
            recovery: "Rewrite the statement as one SELECT.",
          },
  };
}
