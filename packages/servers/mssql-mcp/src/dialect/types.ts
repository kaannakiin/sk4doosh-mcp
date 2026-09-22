import {
  asciiLower,
  type ColumnKind,
  type NativeColumn,
} from "@sk-mcp/db-core";

/**
 * Guard: the same column is named twice by two vocabularies — the driver reports
 * `NVarChar` from a result set, the catalogue reports `nvarchar` from
 * `sys.types`. Folding to lower ASCII is what lets one table answer both; a
 * locale-dependent fold would break the dotted I on a Turkish system.
 */
const kinds: Readonly<Record<string, ColumnKind>> = {
  bit: "boolean",
  tinyint: "integer",
  smallint: "integer",
  int: "integer",
  bigint: "bigint",
  decimal: "decimal",
  numeric: "decimal",
  money: "decimal",
  smallmoney: "decimal",
  float: "float",
  real: "float",
  char: "text",
  nchar: "text",
  varchar: "text",
  nvarchar: "text",
  text: "text",
  ntext: "text",
  sysname: "text",
  binary: "binary",
  varbinary: "binary",
  image: "binary",
  timestamp: "binary",
  rowversion: "binary",
  uniqueidentifier: "uuid",
  xml: "xml",
  date: "date",
  time: "time",
  datetime: "timestamp",
  datetime2: "timestamp",
  smalldatetime: "timestamp",
  datetimeoffset: "timestamptz",
};

export function classify(column: NativeColumn): ColumnKind {
  return kinds[asciiLower(column.typeName)] ?? "unknown";
}
