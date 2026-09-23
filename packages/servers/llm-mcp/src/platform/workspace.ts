import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ErrorFactory } from "@sk-mcp/mcp-core";
import type { SkMcpLlmErrorCode } from "./errors.js";

declare const workspaceBrand: unique symbol;

export type WorkspacePath = string & { readonly [workspaceBrand]: true };

export interface Workspace {
  readonly root: string;
  resolve(requested: string): Promise<WorkspacePath>;
  readText(path: WorkspacePath, maxBytes: number): Promise<string>;
  redact(detail: string): string;
}

function isContained(root: string, candidate: string): boolean {
  if (candidate === root) {
    return true;
  }
  const rest = relative(root, candidate);
  return (
    rest !== "" &&
    rest !== ".." &&
    !rest.startsWith(`..${sep}`) &&
    !isAbsolute(rest)
  );
}

function decodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

const outsideRecovery = "Pass a path relative to the working directory.";

/**
 * Opens the directory every path argument is resolved against.
 *
 * Guard: containment is checked on the requested path and again on its
 * realpath, because a symlink inside the workspace may point anywhere; checking
 * only the first would let the local model read what the agent's sandbox
 * cannot. A `WorkspacePath` is minted only after both checks.
 *
 * @param raw the workspace directory
 * @param fail the server's error factory
 * @returns the opened workspace, or throws when `raw` is not a directory
 */
export async function openWorkspace(
  raw: string,
  fail: ErrorFactory<SkMcpLlmErrorCode>,
): Promise<Workspace> {
  const root = await realpath(resolve(raw));
  if (!(await stat(root)).isDirectory()) {
    throw fail(
      "invalid_argument",
      `The workspace '${raw}' is not a directory.`,
    );
  }

  const redact = (detail: string): string => detail.replaceAll(root, ".");

  const resolvePath = async (requested: string): Promise<WorkspacePath> => {
    if (requested === "" || requested.includes("\0")) {
      throw fail(
        "invalid_argument",
        "A path must be non-empty and free of NUL bytes.",
        outsideRecovery,
      );
    }
    const outside = fail(
      "outside_workspace",
      `'${requested}' resolves outside the working directory.`,
      outsideRecovery,
    );
    const joined = resolve(root, requested);
    if (!isContained(root, joined)) {
      throw outside;
    }
    const missing = fail(
      "file_not_found",
      `'${requested}' is not a readable file in the working directory.`,
      "List the working directory and pass an existing file.",
    );
    let real: string;
    try {
      real = await realpath(joined);
    } catch {
      throw missing;
    }
    if (!isContained(root, real)) {
      throw outside;
    }
    if (!(await stat(real)).isFile()) {
      throw missing;
    }
    return real as WorkspacePath;
  };

  const readText = async (
    path: WorkspacePath,
    maxBytes: number,
  ): Promise<string> => {
    const shown = relative(root, path);
    const { size } = await stat(path);
    if (size > maxBytes) {
      throw fail(
        "input_too_large",
        `'${shown}' is ${String(size)} bytes; one local call can read at most ${String(maxBytes)}.`,
        "Split the input and call once per part, or do the work yourself.",
      );
    }
    const text = decodeUtf8(await readFile(path));
    if (text === undefined || text.includes("\0")) {
      throw fail(
        "not_text",
        `'${shown}' is not UTF-8 text.`,
        "Pass a plain text or CSV file.",
      );
    }
    return text;
  };

  return { root, resolve: resolvePath, readText, redact };
}
