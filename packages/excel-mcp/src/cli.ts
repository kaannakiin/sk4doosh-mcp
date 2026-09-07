#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseServerArgv } from "@sk-mcp/file-core";
import { createWorkbookRoot } from "./paths.js";
import { createExcelMcpServer } from "./server.js";

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const parsed = parseServerArgv(process.argv);

if (parsed.kind === "usage") {
  fail("Usage: sk-mcp-excel <workbook-root>", 2);
}

try {
  const root = await createWorkbookRoot(parsed.path);
  const server = createExcelMcpServer(root);
  await server.connect(new StdioServerTransport());
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), 1);
}
