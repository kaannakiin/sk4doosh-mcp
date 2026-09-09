import { createRequire } from "node:module";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createFileSourceServer } from "@sk-mcp/file-core";
import type { DocumentRoot } from "./paths.js";
import { createHandlers, toolDefinitions } from "./tools.js";
import { createXmlWorkerPool, type XmlWorkerPool } from "./worker-pool.js";
import { createXmlDocumentCache } from "./document.js";

const manifest = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

export function createXmlMcpServer(root: DocumentRoot): McpServer {
  const pool: XmlWorkerPool = createXmlWorkerPool();
  const documents = createXmlDocumentCache(pool, root.real);
  const server = createFileSourceServer(
    { name: "sk-mcp-xml", version: manifest.version },
    toolDefinitions,
    createHandlers(root),
  );
  const close = server.close.bind(server);
  server.close = async () => {
    await pool.close();
    documents.clear();
    await close();
  };
  return server;
}
