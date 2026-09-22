import type { ErrorFactory } from "@sk-mcp/mcp-core";
import type { DbErrorCode } from "./errors.js";
import { dbCoreLimits, type DbLimits } from "./limits.js";
import type {
  ConnectionPool,
  ConnectionProfile,
  DriverAdapter,
} from "./model/connection.js";
import type { Dialect } from "./model/dialect.js";
import { baseSecretPatterns, redactSecrets } from "./primitives/redact.js";
import { createConnectionPool } from "./pool/pool.js";
import { createQueryRunner, type QueryRunner } from "./query/execute.js";
import type { DbVocabulary } from "./vocabulary.js";

export interface DbEnvironment<TConfig> {
  readonly dialect: Dialect<TConfig>;
  readonly vocabulary: DbVocabulary<string>;
  readonly fail: ErrorFactory<DbErrorCode>;
  readonly limits?: DbLimits;
}

export interface DbSource<TConfig> {
  readonly dialect: Dialect<TConfig>;
  readonly vocabulary: DbVocabulary<string>;
  readonly fail: ErrorFactory<DbErrorCode>;
  readonly limits: DbLimits;
  readonly profile: ConnectionProfile<TConfig>;
  /** What the connection-level read-only posture actually guarantees. */
  readonly sessionIntent: "read_only" | "none";
  readonly pool: ConnectionPool;
  readonly runner: QueryRunner;
  /** Strips connection secrets from any string bound for a tool response. */
  readonly redact: (detail: string) => string;
  close(): Promise<void>;
}

/**
 * Binds one dialect, one connection profile and one driver adapter into the
 * object every tool handler reaches the database through.
 *
 * Guard: the redactor is assembled here, from the core's patterns plus the
 * dialect's, so a server cannot be composed without one. It is the seam
 * `@sk-mcp/mcp-core` leaves open through `ErrorContext.redact`.
 */
export function createDbSource<TConfig>(
  environment: DbEnvironment<TConfig>,
  profile: ConnectionProfile<TConfig>,
  driver: DriverAdapter<TConfig>,
): DbSource<TConfig> {
  const limits = environment.limits ?? dbCoreLimits;
  const { dialect, vocabulary, fail } = environment;
  const config = profile.secret.reveal();
  const patterns = [...baseSecretPatterns, ...dialect.secretPatterns];

  const pool = createConnectionPool({
    driver,
    config,
    limits,
    fail,
    sessionSetup: dialect.sessionSetup(config),
  });

  const runner = createQueryRunner({ pool, dialect, driver, limits, fail });

  return {
    dialect,
    vocabulary,
    fail,
    limits,
    profile,
    sessionIntent: dialect.sessionIntent(config),
    pool,
    runner,
    redact: (detail) => redactSecrets(detail, patterns),
    close: () => pool.close(),
  };
}
