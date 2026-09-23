import type { CallToolResult } from "@modelcontextprotocol/server";
import {
  createDocumentRoot,
  type DocumentRoot,
} from "../../src/platform/paths.js";
import { createHandlers } from "../../src/tools/handlers.js";
import type { ToolHandlers } from "../../src/tools/definitions.js";

export interface Harness {
  readonly root: DocumentRoot;
  readonly handlers: ToolHandlers;
}

export async function createHarness(rootPath: string): Promise<Harness> {
  const root = await createDocumentRoot(rootPath);
  return { root, handlers: createHandlers(root) };
}

export function bodyOf(result: CallToolResult): Record<string, unknown> {
  const block = result.content[0];
  if (block === undefined || block.type !== "text") {
    throw new Error("Expected a text block.");
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

export async function codeOf(
  run: () => Promise<CallToolResult>,
): Promise<string> {
  const result = await run();
  if (result.isError !== true) {
    throw new Error("Expected an error result.");
  }
  return String(bodyOf(result)["error"]);
}
