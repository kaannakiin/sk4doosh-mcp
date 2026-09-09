#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseServerArgv } from "@sk-mcp/file-core";
import { createDocumentRoot } from "./paths.js";
import { createXmlMcpServer } from "./server.js";

function fail(message: string, code: number): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

const parsed = parseServerArgv(process.argv);

if (parsed.kind === "usage") {
  fail("Usage: sk-mcp-xml <xml-source-root>", 2);
}

try {
  const root = await createDocumentRoot(parsed.path);
  const server = createXmlMcpServer(root);
  await server.connect(new StdioServerTransport());
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), 1);
}
