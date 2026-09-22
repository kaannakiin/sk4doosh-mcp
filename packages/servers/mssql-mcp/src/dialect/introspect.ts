import {
  sqlText,
  type ColumnDescriptor,
  type Introspection,
  type IntrospectionQuery,
  type IntrospectionScope,
  type KeyEntry,
  type QueryParameter,
  type QuerySpec,
  type RowRecord,
  type ServerFacts,
  type TableEntry,
  type TableRef,
} from "@sk-mcp/db-core";
import { classify } from "./types.js";

/**
 * Guard: the column list is joined server-side with the unit separator rather
 * than a comma, because a bracketed identifier may legally contain a comma and
 * splitting on one would invent columns that do not exist.
 */
const SEPARATOR = "char(31)";

const spec = (
  sql: string,
  parameters: readonly QueryParameter[],
  timeoutMs: number,
  maxRows: number,
): QuerySpec => ({ sql: sqlText(sql), parameters, timeoutMs, maxRows });

const text = (row: RowRecord, key: string): string =>
  typeof row[key] === "string" ? row[key] : String(row[key] ?? "");

const list = (row: RowRecord, key: string): readonly string[] => {
  const raw = row[key];
  return typeof raw === "string" && raw.length > 0 ? raw.split("\u001f") : [];
};

const number = (row: RowRecord, key: string): number | undefined => {
  const raw = row[key];
  return typeof raw === "number" ? raw : undefined;
};

export function createIntrospection(
  timeoutMs: number,
  maxResults: number,
): Introspection {
  return {
    server: (): IntrospectionQuery<ServerFacts> => ({
      spec: spec(
        `select
           cast(serverproperty('ProductVersion') as nvarchar(128)) as engineVersion,
           db_name() as [catalog],
           current_user as principal`,
        [],
        timeoutMs,
        1,
      ),
      project: (row) => ({
        engineVersion: text(row, "engineVersion"),
        catalog: text(row, "catalog"),
        principal: text(row, "principal"),
      }),
    }),

    tables: (scope: IntrospectionScope): IntrospectionQuery<TableEntry> => ({
      spec: spec(
        `select top (@maxResults)
           s.name as [schema],
           o.name as [name],
           case o.kind when 'V' then 'view' else 'table' end as [kind]
         from (
           select name, schema_id, 'U' as kind from sys.tables
           union all
           select name, schema_id, 'V' as kind from sys.views
         ) o
         join sys.schemas s on s.schema_id = o.schema_id
         where (@schema is null or s.name = @schema)
           and (@namePattern is null or o.name like @namePattern)
           and (@includeViews = 1 or o.kind = 'U')
         order by s.name, o.name`,
        [
          { name: "maxResults", value: scope.maxResults, kind: "integer" },
          { name: "schema", value: scope.schema ?? null, kind: "text" },
          {
            name: "namePattern",
            value: scope.namePattern ?? null,
            kind: "text",
          },
          {
            name: "includeViews",
            value: scope.includeViews ? 1 : 0,
            kind: "integer",
          },
        ],
        timeoutMs,
        scope.maxResults,
      ),
      project: (row) => ({
        schema: text(row, "schema"),
        name: text(row, "name"),
        kind: text(row, "kind") === "view" ? "view" : "table",
      }),
    }),

    columns: (ref: TableRef): IntrospectionQuery<ColumnDescriptor> => ({
      spec: spec(
        `select
           c.name as [name],
           cast(row_number() over (order by c.column_id) - 1 as int) as [ordinal],
           t.name as [nativeType],
           c.is_nullable as [nullable],
           c.max_length as [maxLength],
           c.precision as [precision],
           c.scale as [scale]
         from sys.columns c
         join sys.types t on t.user_type_id = c.user_type_id
         where c.object_id = object_id(quotename(@schema) + '.' + quotename(@table))
         order by c.column_id`,
        [
          { name: "schema", value: ref.schema, kind: "text" },
          { name: "table", value: ref.name, kind: "text" },
        ],
        timeoutMs,
        maxResults,
      ),
      project: (row) => {
        const nativeType = text(row, "nativeType");
        const precision = number(row, "precision");
        const scale = number(row, "scale");
        const maxLength = number(row, "maxLength");
        return {
          name: text(row, "name"),
          ordinal: number(row, "ordinal") ?? 0,
          kind: classify({
            typeName: nativeType,
            ...(maxLength === undefined ? {} : { maxLength }),
            ...(precision === undefined ? {} : { precision }),
            ...(scale === undefined ? {} : { scale }),
          }),
          nativeType,
          nullable: row["nullable"] === true || row["nullable"] === 1,
          ...(maxLength === undefined ? {} : { maxLength }),
          ...(precision === undefined ? {} : { precision }),
          ...(scale === undefined ? {} : { scale }),
        };
      },
    }),

    keys: (ref: TableRef): IntrospectionQuery<KeyEntry> => ({
      spec: spec(
        `select
           kc.name as [name],
           case kc.type when 'PK' then 'primary' else 'unique' end as [kind],
           string_agg(c.name, ${SEPARATOR}) within group (order by ic.key_ordinal) as [columns],
           cast(null as nvarchar(128)) as [referencedSchema],
           cast(null as nvarchar(128)) as [referencedTable],
           cast(null as nvarchar(max)) as [referencedColumns]
         from sys.key_constraints kc
         join sys.index_columns ic
           on ic.object_id = kc.parent_object_id
          and ic.index_id = kc.unique_index_id
          and ic.key_ordinal > 0
         join sys.columns c
           on c.object_id = ic.object_id and c.column_id = ic.column_id
         where kc.parent_object_id = object_id(quotename(@schema) + '.' + quotename(@table))
         group by kc.name, kc.type

         union all

         select
           fk.name as [name],
           'foreign' as [kind],
           string_agg(pc.name, ${SEPARATOR}) within group (order by fkc.constraint_column_id) as [columns],
           rs.name as [referencedSchema],
           rt.name as [referencedTable],
           string_agg(rc.name, ${SEPARATOR}) within group (order by fkc.constraint_column_id) as [referencedColumns]
         from sys.foreign_keys fk
         join sys.foreign_key_columns fkc on fkc.constraint_object_id = fk.object_id
         join sys.columns pc
           on pc.object_id = fkc.parent_object_id and pc.column_id = fkc.parent_column_id
         join sys.columns rc
           on rc.object_id = fkc.referenced_object_id and rc.column_id = fkc.referenced_column_id
         join sys.tables rt on rt.object_id = fk.referenced_object_id
         join sys.schemas rs on rs.schema_id = rt.schema_id
         where fk.parent_object_id = object_id(quotename(@schema) + '.' + quotename(@table))
         group by fk.name, rs.name, rt.name`,
        [
          { name: "schema", value: ref.schema, kind: "text" },
          { name: "table", value: ref.name, kind: "text" },
        ],
        timeoutMs,
        maxResults,
      ),
      project: (row) => {
        const kind = text(row, "kind");
        const referencedSchema = row["referencedSchema"];
        const referencedTable = row["referencedTable"];
        return {
          name: text(row, "name"),
          kind:
            kind === "primary"
              ? "primary"
              : kind === "foreign"
                ? "foreign"
                : "unique",
          columns: list(row, "columns"),
          ...(typeof referencedSchema === "string" ? { referencedSchema } : {}),
          ...(typeof referencedTable === "string" ? { referencedTable } : {}),
          ...(kind === "foreign"
            ? { referencedColumns: list(row, "referencedColumns") }
            : {}),
        };
      },
    }),
  };
}
