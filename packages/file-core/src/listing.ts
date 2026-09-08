import { extname, basename, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setImmediate as yieldTurn } from "node:timers/promises";
import type { NativeEntry } from "@sk-mcp/file-core-native";
import { accessError } from "./access.js";
import { isContained, type SandboxRoot } from "./paths.js";
import { asciiLower, fold } from "./unicode.js";

/** Bounded glob matching avoids user-controlled RegExp backtracking. */
function globMatches(pattern: string, value: string): boolean {
  let previous = new Uint8Array(value.length + 1);
  previous[0] = 1;
  for (let p = 0; p < pattern.length; p += 1) {
    const next = new Uint8Array(value.length + 1);
    const token = pattern[p];
    if (token === "*") {
      const recursive = pattern[p + 1] === "*";
      if (recursive) p += 1;
      next[0] = previous[0] ?? 0;
      for (let i = 1; i <= value.length; i += 1) {
        next[i] =
          previous[i] || ((recursive || value[i - 1] !== "/") && next[i - 1])
            ? 1
            : 0;
      }
    } else {
      for (let i = 1; i <= value.length; i += 1) {
        next[i] =
          previous[i - 1] &&
          (token === "?" ? value[i - 1] !== "/" : token === value[i - 1])
            ? 1
            : 0;
      }
    }
    previous = next;
  }
  return previous[value.length] === 1;
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
  readonly totalExact: boolean;
  readonly truncated: boolean;
  readonly scanTruncated: boolean;
  readonly scanTruncationReason?: "entries" | "depth" | "time";
  readonly unreadable?: number;
}

export async function listSources(
  root: SandboxRoot,
  options: ListOptions,
): Promise<SourceListing> {
  const deadline = performance.now() + 1000;
  const joined = resolve(root.real, options.subdirectory ?? ".");
  if (!isContained(root.real, joined))
    throw root.fail(
      "path_outside_root",
      "The subdirectory resolves outside the configured root.",
    );
  const pattern = fold(options.pattern ?? "*");
  if (
    pattern.length > 256 ||
    !Number.isSafeInteger(options.maxResults) ||
    options.maxResults < 0
  ) {
    throw root.fail(
      "invalid_argument",
      "Invalid listing pattern or result budget.",
    );
  }
  let scan;
  try {
    scan = await root.access.scan(
      relative(root.real, joined),
      Math.min(root.maxListScan, 5000),
      64,
      1000,
    );
  } catch (error) {
    const mapped = accessError(error, root.fail);
    if (mapped.code === "file_not_found")
      throw root.fail(
        "file_not_found",
        `No directory at '${options.subdirectory ?? "."}' under the configured root.`,
        `Call ${root.vocabulary.listTool} without subdirectory.`,
      );
    throw mapped;
  }
  const candidates: NativeEntry[] = [];
  let reason = scan.reason;
  for (const [index, entry] of scan.entries.entries()) {
    if (index % 128 === 0) await yieldTurn();
    if (performance.now() >= deadline) {
      reason = "time";
      break;
    }
    if (
      !entry.directory &&
      root.formats.has(asciiLower(extname(entry.path))) &&
      (globMatches(pattern, fold(entry.path)) ||
        globMatches(pattern, fold(basename(entry.path))))
    )
      candidates.push(entry);
  }
  candidates.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const files = candidates.slice(0, options.maxResults).map((entry) => ({
    filePath: entry.path,
    sizeBytes: entry.size,
    modifiedAt: new Date(entry.modifiedMs).toISOString(),
  }));
  return {
    files,
    total: candidates.length,
    totalExact: reason === null && scan.unreadable === 0,
    truncated: candidates.length > files.length,
    scanTruncated: reason !== null,
    ...(reason === null ? {} : { scanTruncationReason: reason }),
    ...(scan.unreadable > 0 ? { unreadable: scan.unreadable } : {}),
  };
}
