import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createXmlDocumentCache } from "../../src/document.js";
import { createDocumentRoot } from "../../src/paths.js";
import { createHandlers, type ToolHandlers } from "../../src/tools.js";
import {
  createXmlWorkerPool,
  type XmlWorkerPool,
} from "../../src/worker-pool.js";

export interface Harness {
  readonly handlers: ToolHandlers;
  readonly pool: XmlWorkerPool;
  close(): Promise<void>;
}

export async function createHarness(
  rootPath: string,
  poolOptions?: Parameters<typeof createXmlWorkerPool>[0],
): Promise<Harness> {
  const root = await createDocumentRoot(rootPath);
  const pool = createXmlWorkerPool(poolOptions);
  const cache = createXmlDocumentCache(pool, root.real);
  const handlers = createHandlers(root, { pool, cache });
  return {
    handlers,
    pool,
    async close() {
      await pool.close();
      cache.clear();
    },
  };
}

export function bodyOf(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (block === undefined || block.type !== "text") {
    throw new Error("the tool returned no text block");
  }
  return JSON.parse(block.text) as Record<string, unknown>;
}

export function bytesOf(result: CallToolResult): number {
  let total = 0;
  for (const block of result.content) {
    if (block.type === "text") total += Buffer.byteLength(block.text, "utf8");
  }
  return total;
}
