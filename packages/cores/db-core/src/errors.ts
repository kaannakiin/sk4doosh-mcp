import { McpSourceError, type SourceErrorCode } from "@sk-mcp/mcp-core";

export type { ErrorFactory, ErrorContext } from "@sk-mcp/mcp-core";

export type DbErrorCode =
  | SourceErrorCode
  | "connection_failed"
  | "authentication_failed"
  | "query_timeout"
  | "query_cancelled"
  | "query_failed"
  | "write_not_permitted"
  | "object_not_found"
  | "permission_denied"
  | "unsupported_type"
  | "deadlock";

export class DbSourceError extends McpSourceError {}
