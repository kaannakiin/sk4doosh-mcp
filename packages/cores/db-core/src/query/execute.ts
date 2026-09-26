import { McpSourceError, type ErrorFactory } from "@liaiso/mcp-core";
import type { DbErrorCode } from "../errors.js";
import type {
  ConnectionPool,
  DriverAdapter,
  PoolLimits,
} from "../model/connection.js";
import type { Dialect } from "../model/dialect.js";
import type { QueryResult, QuerySpec } from "../model/sql.js";
import { runCancellable } from "../pool/cancel.js";

export interface QueryRunner {
  run(spec: QuerySpec, signal?: AbortSignal): Promise<QueryResult>;
}

export interface QueryRunnerSpec<TConfig> {
  readonly pool: ConnectionPool;
  readonly dialect: Dialect<TConfig>;
  readonly driver: DriverAdapter<TConfig>;
  readonly limits: PoolLimits;
  readonly fail: ErrorFactory<DbErrorCode>;
}

export function createQueryRunner<TConfig>(
  spec: QueryRunnerSpec<TConfig>,
): QueryRunner {
  const { pool, dialect, driver, limits, fail } = spec;
  return {
    async run(query: QuerySpec, signal?: AbortSignal): Promise<QueryResult> {
      const lease = await pool.acquire(signal);
      try {
        return await runCancellable(lease, query, signal, limits, fail);
      } catch (error) {
        /**
         * Guard: a connection the driver calls broken must not go back to the
         * pool. `runCancellable` already quarantines the cancellation case; this
         * covers a protocol or socket failure, where reuse would surface as an
         * unrelated error on someone else's call.
         */
        if (driver.isBroken(error)) {
          lease.quarantine();
        }
        throw classify(error, dialect, fail);
      } finally {
        lease.release();
      }
    },
  };
}

function classify<TConfig>(
  error: unknown,
  dialect: Dialect<TConfig>,
  fail: ErrorFactory<DbErrorCode>,
): unknown {
  if (error instanceof McpSourceError) {
    return error;
  }
  const mapped = dialect.mapDriverError(error);
  if (mapped === undefined) {
    return error;
  }
  const detail =
    mapped.engineCode === undefined
      ? mapped.message
      : `${mapped.message} (${String(mapped.engineCode)})`;
  return fail(mapped.code, detail, mapped.recovery);
}
