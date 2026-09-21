#!/usr/bin/env node
import { parseServerArgv, serveFileSourceStdio } from "@sk-mcp/file-core";
import { createDocumentRoot } from "./host/platform/paths.js";
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
  /**
   * Guard: stdio carries one connection per process, so pinning the single eagerly built instance
   * is what `serveStdio`'s per-connection factory would produce anyway — and it keeps a
   * construction failure fatal here instead of surfacing as an out-of-band error after the client
   * has already opened.
   */
  serveFileSourceStdio(() => server);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error), 1);
}
