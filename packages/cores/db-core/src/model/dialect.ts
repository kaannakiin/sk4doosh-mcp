import type { ErrorFactory } from "@sk-mcp/mcp-core";
import type { DbErrorCode } from "../errors.js";
import type { SecretPattern } from "../primitives/redact.js";
import type {
  IntrospectionScope,
  KeyEntry,
  ServerFacts,
  TableEntry,
  TableRef,
} from "./catalog.js";
import type { QuerySpec, QuotedIdentifier } from "./sql.js";
import type { ColumnDescriptor, NativeColumn, TypeFacts } from "./value.js";

export type GuardOutcome =
  | { readonly verdict: "allow"; readonly statement: QuerySpec["sql"] }
  | {
      readonly verdict: "refuse";
      readonly reason: string;
      readonly recovery: string;
    };

export interface DriverFailure {
  readonly code: DbErrorCode;
  readonly message: string;
  readonly recovery?: string;
  /** The engine's own code, safe to echo once the message is redacted. */
  readonly engineCode?: string | number;
}

export type RowRecord = Readonly<Record<string, unknown>>;

/**
 * One introspection question and the projector for its answer, born together so
 * a renamed column in the query cannot silently outlive its reader.
 */
export interface IntrospectionQuery<T> {
  readonly spec: QuerySpec;
  project(row: RowRecord): T;
}

export interface Introspection {
  tables(scope: IntrospectionScope): IntrospectionQuery<TableEntry>;
  columns(ref: TableRef): IntrospectionQuery<ColumnDescriptor>;
  keys(ref: TableRef): IntrospectionQuery<KeyEntry>;
  server(): IntrospectionQuery<ServerFacts>;
}

/**
 * Everything one engine knows that another does not. A second engine is a
 * second implementation of this interface plus a driver adapter — if it needs
 * more than that, the seam is in the wrong place.
 *
 * Guard: the interface has no optional member, so `as const satisfies
 * Dialect<…>` reports a missing one by name at the implementation's object
 * literal rather than at the first call.
 */
export interface Dialect<TConfig> {
  /** Stable machine id. Appears in `describe_connection`. */
  readonly id: string;

  readonly secretPatterns: readonly SecretPattern[];

  /** Statements run once per physical connection before it serves a query. */
  sessionSetup(config: TConfig): readonly QuerySpec[];

  /** What the connection-level read-only posture actually guarantees. */
  sessionIntent(config: TConfig): "read_only" | "none";

  quoteIdentifier(
    name: string,
    fail: ErrorFactory<DbErrorCode>,
  ): QuotedIdentifier;
  quoteQualified(
    ref: TableRef,
    fail: ErrorFactory<DbErrorCode>,
  ): QuotedIdentifier;

  /**
   * Completes one engine type: its kind, the facts the engine defines even when
   * the source omitted them, and whether this engine's driver hands the value
   * over intact.
   */
  describeType(native: NativeColumn): TypeFacts;

  readonly introspection: Introspection;

  mapDriverError(error: unknown): DriverFailure | undefined;

  /**
   * Advisory only. The security boundary is the database principal; this exists
   * so a write attempt returns a legible error instead of a driver permission
   * failure. Its `allow` arm is nonetheless the only producer of `SqlText` from
   * agent input.
   */
  readOnlyGuard(sql: string): GuardOutcome;
}
