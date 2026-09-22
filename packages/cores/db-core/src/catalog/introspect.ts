import type { ColumnDescriptor } from "../model/value.js";
import type { IntrospectionQuery, RowRecord } from "../model/dialect.js";
import type { QueryRunner } from "../query/execute.js";

function toRecord(
  columns: readonly ColumnDescriptor[],
  row: readonly unknown[],
): RowRecord {
  const record: Record<string, unknown> = {};
  for (const column of columns) {
    record[column.name] = row[column.ordinal];
  }
  return record;
}

/**
 * Runs one introspection question and projects every row with the projector it
 * was born with.
 */
export async function introspect<T>(
  runner: QueryRunner,
  query: IntrospectionQuery<T>,
  signal?: AbortSignal,
): Promise<readonly T[]> {
  const result = await runner.run(query.spec, signal);
  return result.rows.map((row) => query.project(toRecord(result.columns, row)));
}

export async function introspectOne<T>(
  runner: QueryRunner,
  query: IntrospectionQuery<T>,
  signal?: AbortSignal,
): Promise<T | undefined> {
  const rows = await introspect(runner, query, signal);
  return rows[0];
}
