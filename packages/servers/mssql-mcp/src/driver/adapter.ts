import mssql from "mssql";
import type {
  ColumnDescriptor,
  DriverAdapter,
  DriverConnection,
  QueryResult,
  QuerySpec,
  RunningQuery,
} from "@sk-mcp/db-core";
import type { MssqlConfig } from "../platform/env.js";
import { classify } from "../dialect/types.js";

type Driver = typeof mssql;

interface ColumnMeta {
  readonly name: string;
  readonly index: number;
  readonly nullable?: boolean;
  readonly length?: number;
  readonly scale?: number;
  readonly precision?: number;
  readonly type?: { readonly name?: string };
}

type Stop = "maxRows" | "deadline" | "caller";

function poolConfig(config: MssqlConfig): mssql.config {
  return {
    server: config.server,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionTimeout: config.connectTimeoutMs,
    requestTimeout: config.queryTimeoutMs,
    options: {
      encrypt: config.encrypt,
      trustServerCertificate: config.trustServerCertificate,
    },
    /**
     * Guard: one physical connection per pool. db-core owns the pooling, and
     * nesting a second pool underneath it would let two calls share a socket
     * behind its back — which is exactly what the cancellation rule depends on
     * not happening.
     */
    pool: { max: 1, min: 0, idleTimeoutMillis: 30_000 },
  };
}

function describe(meta: readonly ColumnMeta[]): ColumnDescriptor[] {
  return meta.map((column) => {
    const typeName = column.type?.name ?? "unknown";
    return {
      name: column.name,
      ordinal: column.index,
      kind: classify({
        typeName,
        ...(column.length === undefined ? {} : { maxLength: column.length }),
        ...(column.precision === undefined
          ? {}
          : { precision: column.precision }),
        ...(column.scale === undefined ? {} : { scale: column.scale }),
      }),
      nativeType: typeName,
      nullable: column.nullable !== false,
      ...(column.length === undefined ? {} : { maxLength: column.length }),
      ...(column.precision === undefined
        ? {}
        : { precision: column.precision }),
      ...(column.scale === undefined ? {} : { scale: column.scale }),
    };
  });
}

function bind(request: mssql.Request, spec: QuerySpec): void {
  for (const parameter of spec.parameters) {
    request.input(parameter.name, parameter.value);
  }
}

function timeoutError(ms: number): Error {
  return Object.assign(new Error(`The query exceeded its ${ms} ms deadline.`), {
    code: "ETIMEOUT",
  });
}

export interface MssqlDriverDeps {
  readonly driver?: Driver;
}

export function createMssqlDriver(
  deps: MssqlDriverDeps = {},
): DriverAdapter<MssqlConfig> {
  const driver = deps.driver ?? mssql;
  let nextId = 0;

  return {
    async open(config: MssqlConfig): Promise<DriverConnection> {
      const pool = await new driver.ConnectionPool(
        poolConfig(config),
      ).connect();
      nextId += 1;
      const id = nextId;
      return {
        id,
        destroy: async () => {
          await pool.close().catch(() => undefined);
        },
        run: (spec: QuerySpec): RunningQuery => {
          const request = pool.request();
          bind(request, spec);
          request.stream = true;
          request.arrayRowMode = true;

          let columns: ColumnDescriptor[] = [];
          const rows: (readonly unknown[])[] = [];
          let stop: Stop | undefined;
          let failure: unknown;
          let done = false;

          let settleWith: (result: QueryResult) => void = () => {};
          let failWith: (error: unknown) => void = () => {};
          const settled = new Promise<QueryResult>((resolve, reject) => {
            settleWith = resolve;
            failWith = reject;
          });

          /**
           * Guard: measured — `request.timeout` does not interrupt a running
           * statement, so the deadline has to be a timer that cancels. Without
           * it a blocked query holds its connection until the server releases
           * it, whatever the caller asked for.
           */
          const deadline = setTimeout(() => {
            if (!done) {
              stop = "deadline";
              request.cancel();
            }
          }, spec.timeoutMs);
          deadline.unref?.();

          const finish = (): void => {
            if (done) {
              return;
            }
            done = true;
            clearTimeout(deadline);
            if (stop === "deadline") {
              failWith(timeoutError(spec.timeoutMs));
              return;
            }
            if (stop === undefined && failure !== undefined) {
              failWith(failure);
              return;
            }
            settleWith({ columns, rows, more: stop === "maxRows" });
          };

          request.on("recordset", (meta: unknown) => {
            columns = describe(
              Array.isArray(meta) ? (meta as ColumnMeta[]) : [],
            );
          });
          request.on("row", (row: unknown) => {
            if (rows.length >= spec.maxRows) {
              if (stop === undefined) {
                stop = "maxRows";
                request.cancel();
              }
              return;
            }
            rows.push(Array.isArray(row) ? (row as unknown[]) : [row]);
          });
          /**
           * Guard: a cancel makes the driver emit `error` and then `done`. Only
           * `done` settles, so a cancel the caller asked for cannot resolve
           * before the request has actually finished on the wire.
           */
          request.on("error", (error: unknown) => {
            failure = error;
          });
          request.on("done", finish);

          void request.query(spec.sql);

          return {
            settled,
            cancel: () => {
              if (!done) {
                stop ??= "caller";
                request.cancel();
              }
            },
          };
        },
      };
    },

    isBroken: (error: unknown): boolean => {
      const code = (error as { code?: unknown } | null)?.code;
      return (
        code === "ESOCKET" || code === "ECONNCLOSED" || code === "ENOTOPEN"
      );
    },
  };
}
