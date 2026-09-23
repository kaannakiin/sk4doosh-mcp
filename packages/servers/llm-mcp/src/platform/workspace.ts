import { mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ErrorFactory } from "@sk-mcp/mcp-core";
import type { SkMcpLlmErrorCode } from "./errors.js";

declare const workspaceBrand: unique symbol;

export type WorkspacePath = string & { readonly [workspaceBrand]: true };

export interface Workspace {
  readonly root: string;
  resolve(requested: string): Promise<WorkspacePath>;
  readText(path: WorkspacePath, maxBytes: number): Promise<string>;
  createOutput(name: string, content: string): Promise<string>;
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

const outputExtension = ".csv";

const maxNameChars = 80;

const maxNameAttempts = 100;

function safeName(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9._-]+/gu, "_")
    .replace(/^[._-]+/u, "")
    .slice(0, maxNameChars);
  return cleaned === "" ? "output" : cleaned;
}

function isTaken(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EEXIST"
  );
}

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
 * @param outputDir where the server may add files, relative to `raw`
 * @returns the opened workspace, or throws when `raw` is not a directory or
 *   `outputDir` lies outside it
 */
export async function openWorkspace(
  raw: string,
  fail: ErrorFactory<SkMcpLlmErrorCode>,
  outputDir = ".llm-mcp/out",
): Promise<Workspace> {
  const root = await realpath(resolve(raw));
  if (!(await stat(root)).isDirectory()) {
    throw fail(
      "invalid_argument",
      `The workspace '${raw}' is not a directory.`,
    );
  }
  const output = resolve(root, outputDir);
  if (!isContained(root, output)) {
    throw fail(
      "outside_workspace",
      `The output directory '${outputDir}' lies outside the workspace.`,
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
        `'${shown}' is ${String(size)} bytes; at most ${String(maxBytes)} can be read for this call.`,
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

  /**
   * Adds one new file under the output directory and returns its path relative
   * to the workspace.
   *
   * Guard: this is the only write the server performs, and it keeps the four
   * promises the `ownOutput` annotation makes (docs/cikti-yazan-tool-karari.md):
   * the directory is re-checked on its realpath so a symlink cannot move it
   * outside; the name is the server's, reduced to a safe alphabet with a fixed
   * extension, so no input can place an `AGENTS.md` or climb a directory; `wx`
   * refuses an existing file or symlink instead of replacing it; nothing is
   * ever deleted.
   */
  const createOutput = async (
    name: string,
    content: string,
  ): Promise<string> => {
    await mkdir(output, { recursive: true });
    const directory = await realpath(output);
    if (!isContained(root, directory)) {
      throw fail(
        "outside_workspace",
        "The output directory resolves outside the workspace.",
      );
    }
    const stem = safeName(name);
    for (let attempt = 0; attempt < maxNameAttempts; attempt += 1) {
      const suffix = attempt === 0 ? "" : `-${String(attempt)}`;
      const target = resolve(directory, `${stem}${suffix}${outputExtension}`);
      try {
        const handle = await open(target, "wx");
        try {
          await handle.writeFile(content, "utf8");
        } finally {
          await handle.close();
        }
        return relative(root, target);
      } catch (error) {
        if (!isTaken(error)) {
          throw error;
        }
      }
    }
    throw fail(
      "internal_error",
      `No free output name was found for '${stem}'.`,
    );
  };

  return { root, resolve: resolvePath, readText, createOutput, redact };
}
