import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WorkbookRoot } from "./paths.js";
import { createHandlers, toolDefinitions } from "./tools.js";

const manifest = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

export function createExcelMcpServer(root: WorkbookRoot): McpServer {
  const server = new McpServer({
    name: "sk-mcp-excel",
    version: manifest.version,
  });
  const handlers = createHandlers(root);

  server.registerTool(
    "list_workbooks",
    toolDefinitions.list_workbooks,
    handlers.list_workbooks,
  );
  server.registerTool(
    "describe_workbook",
    toolDefinitions.describe_workbook,
    handlers.describe_workbook,
  );
  server.registerTool(
    "read_sheet",
    toolDefinitions.read_sheet,
    handlers.read_sheet,
  );
  server.registerTool(
    "get_merged_ranges",
    toolDefinitions.get_merged_ranges,
    handlers.get_merged_ranges,
  );
  server.registerTool(
    "get_data_validations",
    toolDefinitions.get_data_validations,
    handlers.get_data_validations,
  );
  server.registerTool(
    "aggregate_sheet",
    toolDefinitions.aggregate_sheet,
    handlers.aggregate_sheet,
  );
  server.registerTool(
    "find_in_sheet",
    toolDefinitions.find_in_sheet,
    handlers.find_in_sheet,
  );

  return server;
}
