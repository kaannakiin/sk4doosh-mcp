import { realpath, stat } from "node:fs/promises";
import type { NativeRoot } from "@sk-mcp/file-core-native";
import { accessError, pinRoot } from "./access.js";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type { CoreErrorCode, ErrorFactory } from "./errors.js";
import { extensionListOf, type FormatRegistry } from "./formats.js";
import { asciiLower, canonical } from "./unicode.js";
import type { Vocabulary } from "./vocabulary.js";

declare const sandboxedBrand: unique symbol;

export type SandboxedPath = string & { readonly [sandboxedBrand]: true };

export interface SandboxEnvironment {
  readonly formats: FormatRegistry;
  readonly vocabulary: Vocabulary<string>;
  readonly fail: ErrorFactory<CoreErrorCode>;
  readonly maxListScan: number;
}

export interface SandboxRoot extends SandboxEnvironment {
  readonly real: string;
  readonly access: NativeRoot;
}

export function isContained(root: string, candidate: string): boolean {
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

export async function createSandboxRoot(
  raw: string,
  environment: SandboxEnvironment,
): Promise<SandboxRoot> {
  const absolute = resolve(raw);
  let real: string;
  try {
    real = await realpath(absolute);
  } catch {
    throw environment.fail(
      "file_not_found",
      `The ${environment.vocabulary.rootLabel} '${raw}' does not exist.`,
    );
  }
  const info = await stat(real);
  if (!info.isDirectory()) {
    throw environment.fail(
      "not_a_file",
      `The ${environment.vocabulary.rootLabel} '${raw}' is not a directory.`,
    );
  }
  try {
    return { real, access: pinRoot(real), ...environment };
  } catch (error) {
    throw accessError(error, environment.fail);
  }
}

async function canonicalEquivalent(
  root: SandboxRoot,
  target: string,
): Promise<string> {
  try {
    return await root.access.resolve(target);
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== "file_not_found"
    )
      throw error;
    const wanted = canonical(basename(target));
    const parent = dirname(target);
    const listing = await root.access.scan(parent, root.maxListScan, 0, 1000);
    const matches = listing.entries.filter(
      (entry) =>
        dirname(entry.path) === (parent === "." ? "." : parent) &&
        canonical(basename(entry.path)) === wanted,
    );
    const match = matches.length === 1 ? matches[0] : undefined;
    if (match === undefined) {
      throw error;
    }
    return root.access.resolve(match.path);
  }
}

export async function resolveSourcePath(
  root: SandboxRoot,
  requested: string,
): Promise<SandboxedPath> {
  const words = root.vocabulary;
  if (requested === "" || requested.includes("\0")) {
    throw root.fail(
      "invalid_argument",
      "filePath must be a non-empty path without NUL bytes.",
      `Call ${words.listTool} to see readable files under the root.`,
    );
  }
  const joined = isAbsolute(requested)
    ? requested
    : resolve(root.real, requested);
  if (!root.formats.has(asciiLower(extname(joined)))) {
    throw root.fail(
      "unsupported_extension",
      `'${requested}' is not a ${words.readableLabel}.`,
      `Readable extensions: ${extensionListOf(root.formats)}.`,
    );
  }
  const outside = root.fail(
    "path_outside_root",
    `'${requested}' resolves outside the ${words.rootLabel}.`,
    `Only files under the configured ${words.rootLabel} are readable.`,
  );
  if (!isContained(root.real, joined)) {
    throw outside;
  }
  let real: string;
  try {
    real = join(
      root.real,
      await canonicalEquivalent(root, relative(root.real, joined)),
    );
  } catch (error) {
    const mapped = accessError(error, root.fail);
    if (mapped.code === "file_not_found")
      throw root.fail(
        "file_not_found",
        `No source exists under the ${words.rootLabel}.`,
        `Call ${words.listTool} to see readable files.`,
      );
    throw mapped;
  }
  if (!isContained(root.real, real)) {
    throw outside;
  }
  return real as SandboxedPath;
}
