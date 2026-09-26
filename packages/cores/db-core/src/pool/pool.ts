import type { ErrorFactory } from "@liaiso/mcp-core";
import type { DbErrorCode } from "../errors.js";
import type {
  ConnectionPool,
  DriverAdapter,
  DriverConnection,
  Lease,
  PoolLimits,
} from "../model/connection.js";
import type { QuerySpec } from "../model/sql.js";

export interface ConnectionPoolSpec<TConfig> {
  readonly driver: DriverAdapter<TConfig>;
  readonly config: TConfig;
  readonly limits: PoolLimits;
  readonly fail: ErrorFactory<DbErrorCode>;
  readonly sessionSetup: readonly QuerySpec[];
}

interface Waiter {
  readonly resolve: (connection: DriverConnection) => void;
  readonly reject: (error: unknown) => void;
  settled: boolean;
}

function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  onTimeout: () => Error,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(onTimeout());
    }, ms);
    timer.unref?.();
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createConnectionPool<TConfig>(
  spec: ConnectionPoolSpec<TConfig>,
): ConnectionPool {
  const { driver, config, limits, fail } = spec;
  const idle: DriverConnection[] = [];
  const waiters: Waiter[] = [];
  let opened = 0;
  let generation = 0;
  let closed = false;

  async function open(signal?: AbortSignal): Promise<DriverConnection> {
    const connection = await withTimeout(
      driver.open(config, signal),
      limits.connectTimeoutMs,
      () =>
        fail(
          "connection_failed",
          `The connection was not established within ${limits.connectTimeoutMs} ms.`,
          "Check that the server is reachable and accepting connections.",
        ),
    );
    for (const statement of spec.sessionSetup) {
      await connection.run(statement).settled;
    }
    return connection;
  }

  function handOff(connection: DriverConnection): boolean {
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      if (waiter === undefined || waiter.settled) {
        continue;
      }
      waiter.settled = true;
      waiter.resolve(connection);
      return true;
    }
    return false;
  }

  function discard(connection: DriverConnection): void {
    opened -= 1;
    /**
     * Guard: the generation is the "this pool reconnected" signal. Anything
     * cached against a connection — a cursor, a schema snapshot — is only valid
     * within one generation, so it has to move even though F1 caches nothing.
     */
    generation += 1;
    void connection.destroy().catch(() => undefined);
  }

  function leaseFor(connection: DriverConnection): Lease {
    let released = false;
    let poisoned = false;
    const born = generation;
    return {
      connection,
      generation: born,
      quarantine: () => {
        poisoned = true;
      },
      release: () => {
        if (released) {
          return;
        }
        released = true;
        if (poisoned || closed) {
          discard(connection);
          return;
        }
        if (!handOff(connection)) {
          idle.push(connection);
        }
      },
    };
  }

  return {
    get generation() {
      return generation;
    },

    async acquire(signal?: AbortSignal): Promise<Lease> {
      if (closed) {
        throw fail("internal_error", "The connection pool is closed.");
      }
      if (signal?.aborted === true) {
        throw fail("query_cancelled", "The call was cancelled before it ran.");
      }
      const free = idle.pop();
      if (free !== undefined) {
        return leaseFor(free);
      }
      if (opened < limits.maxConnections) {
        opened += 1;
        try {
          return leaseFor(await open(signal));
        } catch (error) {
          opened -= 1;
          throw error;
        }
      }
      if (waiters.length >= limits.maxQueueDepth) {
        throw fail(
          "resource_limit",
          `${limits.maxQueueDepth} calls are already waiting for a connection.`,
          "Retry once the calls in flight have finished.",
        );
      }
      const connection = await new Promise<DriverConnection>(
        (resolve, reject) => {
          const waiter: Waiter = { resolve, reject, settled: false };
          waiters.push(waiter);
          signal?.addEventListener(
            "abort",
            () => {
              if (waiter.settled) {
                return;
              }
              waiter.settled = true;
              reject(
                fail(
                  "query_cancelled",
                  "The call was cancelled while it waited for a connection.",
                ),
              );
            },
            { once: true },
          );
        },
      );
      return leaseFor(connection);
    },

    async close(): Promise<void> {
      closed = true;
      for (const waiter of waiters.splice(0)) {
        if (!waiter.settled) {
          waiter.settled = true;
          waiter.reject(fail("internal_error", "The server is shutting down."));
        }
      }
      const open = idle.splice(0);
      opened -= open.length;
      await Promise.all(
        open.map((connection) => connection.destroy().catch(() => undefined)),
      );
    },
  };
}
