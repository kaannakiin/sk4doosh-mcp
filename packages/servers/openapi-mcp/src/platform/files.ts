import { readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export const directoryOf = (path: string): string => dirname(resolve(path));

export function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

/**
 * Reads a file an external `$ref` names.
 *
 * Guard: the path is checked against the root on its realpath, not on the string, so neither
 * `../` nor a symbolic link can make a document read a file outside the directory it came from.
 */
export async function readWithin(root: string, path: string): Promise<string> {
  const base = await realpath(root);
  const target = await realpath(resolve(base, path));
  const offset = relative(base, target);
  if (offset.startsWith("..") || isAbsolute(offset)) {
    throw new Error(
      `sk-mcp-openapi: '${path}' is outside the document's directory.`,
    );
  }
  return readFile(target, "utf8");
}
