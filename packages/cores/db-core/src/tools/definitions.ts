import {
  readOnly,
  toolNamesOf,
  type HandlersOf,
  type ToolDefinitions,
  type ToolInputOf,
  type ToolNameOf,
} from "@sk-mcp/mcp-core";
import { z } from "zod";
import { dbCoreLimits } from "../limits.js";

const identifier = z.string().min(1).max(256);

export const toolDefinitions = {
  describe_connection: {
    description:
      "Report which database this server is connected to, what the connection may do, and the limits every other tool is bound by. Takes no arguments and never returns credentials.",
    inputSchema: z.object({}),
    annotations: readOnly,
  },
  list_tables: {
    description:
      "List the tables and views the connected principal can read, schema-qualified. Start here: the names it returns are the ones describe_table and run_query accept.",
    inputSchema: z.object({
      schema: identifier.optional(),
      namePattern: z.string().min(1).max(256).optional(),
      includeViews: z.boolean().optional(),
      maxResults: z
        .number()
        .int()
        .min(1)
        .max(dbCoreLimits.maxListResults)
        .optional(),
    }),
    annotations: readOnly,
  },
  describe_table: {
    description:
      "Report one table's columns with their types and nullability, plus its primary, unique and foreign keys. Read this before writing a query against the table.",
    inputSchema: z.object({ schema: identifier, table: identifier }),
    annotations: readOnly,
  },
  run_query: {
    description:
      "Run one read-only SQL statement and return its rows. Writes are refused. The response is capped and there is no cursor, so walk a large result by adding your own ordering and paging clause; a truncated response says which clause this engine uses.",
    inputSchema: z.object({
      sql: z.string().min(1).max(20_000),
      maxRows: z.number().int().min(1).max(dbCoreLimits.maxRows).optional(),
      timeoutMs: z.number().int().min(100).max(600_000).optional(),
    }),
    annotations: readOnly,
  },
} as const satisfies ToolDefinitions;

export type Definitions = typeof toolDefinitions;
export type ToolName = ToolNameOf<Definitions>;
export const toolNames: readonly ToolName[] = toolNamesOf(toolDefinitions);
export type ToolInput<K extends ToolName> = ToolInputOf<Definitions, K>;
export type ToolHandlers = HandlersOf<Definitions>;
