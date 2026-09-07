import { readdir, realpath, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { isContained, type SandboxRoot } from "./paths.js";
import { asciiLower, fold } from "./unicode.js";

function globToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      source += "[^/]";
      continue;
    }
    source += character?.replace(/[.+^${}()|[\]\\]/g, "\\$&") ?? "";
  }
  return new RegExp(`^${source}$`);
}

function errnoOf(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function mapDirectoryError(
  error: unknown,
  label: string,
  root: SandboxRoot,
): never {
  const words = root.vocabulary;
  const errno = errnoOf(error);
  if (errno === "ENOENT") {
    throw root.fail(
      "file_not_found",
      `No directory at '${label}' under the ${words.rootLabel}.`,
      `Call ${words.listTool} without subdirectory to see the readable files under the root.`,
    );
  }
  if (errno === "ENOTDIR") {
    throw root.fail(
      "not_a_file",
      `'${label}' is a file, not a directory.`,
      `Pass a folder under the ${words.rootLabel}, or omit subdirectory.`,
    );
  }
  throw error;
}

export interface SourceEntry {
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
}

export interface ListOptions {
  readonly subdirectory?: string;
  readonly pattern?: string;
  readonly maxResults: number;
}

export interface SourceListing {
  readonly files: readonly SourceEntry[];
  readonly total: number;
  readonly truncated: boolean;
  readonly unreadable?: number;
}

export async function listSources(
  root: SandboxRoot,
  options: ListOptions,
): Promise<SourceListing> {
  const words = root.vocabulary;
  const label = options.subdirectory ?? ".";
  const joined = options.subdirectory
    ? resolve(root.real, options.subdirectory)
    : root.real;
  const outside = root.fail(
    "path_outside_root",
    `'${options.subdirectory ?? ""}' resolves outside the ${words.rootLabel}.`,
    `Use a subdirectory inside the ${words.rootLabel}.`,
  );
  if (!isContained(root.real, joined)) {
    throw outside;
  }
  let base: string;
  try {
    base = await realpath(joined);
  } catch (error) {
    mapDirectoryError(error, label, root);
  }
  if (!isContained(root.real, base)) {
    throw outside;
  }
  const matcher = globToRegExp(fold(options.pattern ?? "*"));
  let entries;
  try {
    entries = await readdir(base, { recursive: true, withFileTypes: true });
  } catch (error) {
    mapDirectoryError(error, label, root);
  }
  const candidates: string[] = [];
  for (const entry of entries) {
    if (candidates.length >= root.maxListScan) {
      break;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }
    if (!root.formats.has(asciiLower(extname(entry.name)))) {
      continue;
    }
    const absolute = join(entry.parentPath, entry.name);
    const filePath = relative(root.real, absolute);
    if (!matcher.test(fold(filePath)) && !matcher.test(fold(entry.name))) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      let target: string;
      try {
        target = await realpath(absolute);
      } catch {
        continue;
      }
      if (!isContained(root.real, target)) {
        continue;
      }
      let info;
      try {
        info = await stat(target);
      } catch {
        continue;
      }
      if (!info.isFile()) {
        continue;
      }
    }
    candidates.push(absolute);
  }
  candidates.sort();
  const files: SourceEntry[] = [];
  let unreadable = 0;
  for (const absolute of candidates.slice(0, options.maxResults)) {
    let info;
    try {
      info = await stat(absolute);
    } catch (error) {
      if (errnoOf(error) === "ENOENT") {
        unreadable += 1;
        continue;
      }
      throw error;
    }
    files.push({
      filePath: relative(root.real, absolute),
      sizeBytes: info.size,
      modifiedAt: new Date(info.mtimeMs).toISOString(),
    });
  }
  return {
    files,
    total: candidates.length,
    truncated: candidates.length > files.length + unreadable,
    ...(unreadable > 0 ? { unreadable } : {}),
  };
}
