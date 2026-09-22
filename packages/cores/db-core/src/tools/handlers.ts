import type { CallToolResult } from "@modelcontextprotocol/server";
import {
  createPageBudget,
  guard,
  json,
  measureJson,
  type ErrorNormalizer,
} from "@sk-mcp/mcp-core";
import { introspect, introspectOne } from "../catalog/introspect.js";
import type { KeyEntry } from "../model/catalog.js";
import type { ColumnDescriptor, JsonScalar } from "../model/value.js";
import type { QueryResult } from "../model/sql.js";
import type { DbSource } from "../source.js";
import { encodeRow, hasPrecisionRisk } from "../values/encode.js";
import {
  type Definitions,
  type ToolHandlers,
  type ToolInput,
  type ToolName,
} from "./definitions.js";

interface WireColumn {
  readonly name: string;
  readonly kind: string;
  readonly nativeType: string;
  readonly nullable: boolean;
  readonly precisionRisk?: true;
}

const wireColumn = (column: ColumnDescriptor): WireColumn => ({
  name: column.name,
  kind: column.kind,
  nativeType: column.nativeType,
  nullable: column.nullable,
  ...(hasPrecisionRisk(column.kind, column.precision)
    ? { precisionRisk: true as const }
    : {}),
});

interface RowPage {
  readonly columns: readonly WireColumn[];
  readonly rows: readonly (readonly JsonScalar[])[];
  readonly returnedCount: number;
  readonly complete: boolean;
  readonly truncated: boolean;
  readonly truncationReason?: "maxPayloadBytes" | "maxRows";
  readonly hint?: string;
}

export function createHandlers<TConfig>(
  source: DbSource<TConfig>,
  normalize: ErrorNormalizer,
): ToolHandlers {
  const { dialect, vocabulary, fail, limits, runner, redact } = source;

  const guarded = <K extends ToolName>(
    tool: K,
    handler: (
      args: ToolInput<K>,
      signal?: AbortSignal,
    ) => Promise<CallToolResult>,
  ) =>
    guard<Definitions, K>(
      { tool, fail, redact },
      async (args, _tool, signal) => handler(args, signal),
      normalize,
    );

  /**
   * Guard: the envelope is measured with no rows and the worst-case truncation
   * fields present, so the reserve already covers the flags a refusal will add.
   * Admitting rows first and hoping they fit is what makes a page overshoot.
   */
  function assemble(result: QueryResult): RowPage {
    const columns = result.columns.map(wireColumn);
    const kinds = result.columns.map((column) => column.kind);
    const policy = {
      maxTextChars: limits.maxTextChars,
      maxBinaryBytes: limits.maxBinaryBytes,
    };
    const reserveBytes = measureJson({
      columns,
      rows: [],
      returnedCount: 0,
      complete: false,
      truncated: true,
      truncationReason: "maxPayloadBytes",
      hint: vocabulary.tooManyRowsRecovery,
    });
    const budget = createPageBudget({
      maxBytes: limits.maxPayloadBytes,
      reserveBytes,
    });
    const rows: (readonly JsonScalar[])[] = [];
    let refused = false;
    for (const row of result.rows) {
      const encoded = encodeRow(row, kinds, policy);
      if (!budget.admit(encoded)) {
        refused = true;
        break;
      }
      rows.push(encoded);
    }
    if (rows.length === 0 && result.rows.length > 0) {
      throw fail(
        "resource_limit",
        `The first row does not fit in the ${limits.maxPayloadBytes} byte response budget.`,
        "Select fewer columns, or narrow the wide ones.",
      );
    }
    const truncated = refused || result.more;
    return {
      columns,
      rows,
      returnedCount: rows.length,
      complete: !truncated,
      truncated,
      ...(refused
        ? { truncationReason: "maxPayloadBytes" as const }
        : result.more
          ? { truncationReason: "maxRows" as const }
          : {}),
      ...(truncated ? { hint: vocabulary.tooManyRowsRecovery } : {}),
    };
  }

  return {
    describe_connection: guarded(
      "describe_connection",
      async (_args, signal) => {
        const facts = await introspectOne(
          runner,
          dialect.introspection.server(),
          signal,
        );
        const { display } = source.profile;
        return json({
          alias: display.alias,
          engine: display.engine,
          dialect: dialect.id,
          ...(facts === undefined
            ? {}
            : { engineVersion: facts.engineVersion }),
          catalog: facts?.catalog ?? display.catalog ?? null,
          principal: facts?.principal ?? display.principal ?? null,
          readOnly: {
            principal:
              "The database principal decides what is readable; this server issues no writes.",
            sessionIntent: source.sessionIntent,
            statementGuard: "advisory",
            note: vocabulary.readOnlyRecovery,
          },
          limits: {
            maxRows: limits.maxRows,
            defaultRows: limits.defaultRows,
            maxColumns: limits.maxColumns,
            maxPayloadBytes: limits.maxPayloadBytes,
            queryTimeoutMs: limits.queryTimeoutMs,
          },
        });
      },
    ),

    list_tables: guarded("list_tables", async (args, signal) => {
      const maxResults = args.maxResults ?? limits.defaultListResults;
      const scope = {
        ...(args.schema === undefined ? {} : { schema: args.schema }),
        ...(args.namePattern === undefined
          ? {}
          : { namePattern: args.namePattern }),
        includeViews: args.includeViews ?? true,
        maxResults,
      };
      const found = await introspect(
        runner,
        dialect.introspection.tables(scope),
        signal,
      );
      const reserveBytes = measureJson({
        catalog: source.profile.display.catalog ?? null,
        tables: [],
        returnedCount: 0,
        complete: false,
        truncated: true,
        truncationReason: "maxPayloadBytes",
        hint: vocabulary.tooManyRowsRecovery,
      });
      const budget = createPageBudget({
        maxBytes: limits.maxPayloadBytes,
        reserveBytes,
      });
      const tables = [];
      let refused = false;
      for (const entry of found.slice(0, maxResults)) {
        if (!budget.admit(entry)) {
          refused = true;
          break;
        }
        tables.push(entry);
      }
      const truncated = refused || found.length > maxResults;
      return json({
        catalog: source.profile.display.catalog ?? null,
        tables,
        returnedCount: tables.length,
        complete: !truncated,
        truncated,
        ...(refused
          ? { truncationReason: "maxPayloadBytes" as const }
          : truncated
            ? { truncationReason: "maxResults" as const }
            : {}),
        ...(truncated
          ? {
              hint: `Narrow the listing with ${vocabulary.schemaLabel} or namePattern.`,
            }
          : {}),
      });
    }),

    describe_table: guarded("describe_table", async (args, signal) => {
      const ref = { schema: args.schema, name: args.table };
      const columns = await introspect(
        runner,
        dialect.introspection.columns(ref),
        signal,
      );
      if (columns.length === 0) {
        throw fail(
          "object_not_found",
          `No readable ${vocabulary.objectLabel} named ${args.schema}.${args.table}.`,
          `Call ${vocabulary.listTool} for the names this connection can read.`,
        );
      }
      if (columns.length > limits.maxColumns) {
        throw fail(
          "resource_limit",
          `${args.schema}.${args.table} has ${columns.length} columns; the limit is ${limits.maxColumns}.`,
          "Query the columns you need by name instead.",
        );
      }
      const keys = await introspect(
        runner,
        dialect.introspection.keys(ref),
        signal,
      );
      const of = (kind: KeyEntry["kind"]) =>
        keys.filter((key) => key.kind === kind);
      const primary = of("primary")[0];
      return json({
        schema: args.schema,
        table: args.table,
        columns: columns.map(wireColumn),
        ...(primary === undefined ? {} : { primaryKey: primary.columns }),
        uniqueKeys: of("unique").map((key) => ({
          name: key.name,
          columns: key.columns,
        })),
        foreignKeys: of("foreign").map((key) => ({
          name: key.name,
          columns: key.columns,
          referencedSchema: key.referencedSchema ?? null,
          referencedTable: key.referencedTable ?? null,
          referencedColumns: key.referencedColumns ?? [],
        })),
      });
    }),

    run_query: guarded("run_query", async (args, signal) => {
      const outcome = dialect.readOnlyGuard(args.sql);
      if (outcome.verdict === "refuse") {
        throw fail("write_not_permitted", outcome.reason, outcome.recovery);
      }
      const result = await runner.run(
        {
          sql: outcome.statement,
          parameters: [],
          timeoutMs: args.timeoutMs ?? limits.queryTimeoutMs,
          maxRows: args.maxRows ?? limits.defaultRows,
        },
        signal,
      );
      return json(assemble(result));
    }),
  };
}
