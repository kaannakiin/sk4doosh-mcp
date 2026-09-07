import { readdir, realpath, stat } from "node:fs/promises";
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
import { SkMcpExcelError } from "./errors.js";
import { limits } from "./limits.js";
import { asciiLower, canonical, fold } from "./unicode.js";

declare const sandboxedBrand: unique symbol;

export type SandboxedPath = string & { readonly [sandboxedBrand]: true };

export interface WorkbookRoot {
  readonly real: string;
}

export type DocumentFormat = "xlsx" | "csv";

export const readableFormats = new Map<string, DocumentFormat>([
  [".xlsx", "xlsx"],
  [".xlsm", "xlsx"],
  [".csv", "csv"],
]);

export const readableExtensions = new Set(readableFormats.keys());

export function formatFor(path: string): DocumentFormat {
  const format = readableFormats.get(asciiLower(extname(path)));
  if (format === undefined) {
    throw new SkMcpExcelError(
      "unsupported_extension",
      `'${path}' is not a readable spreadsheet.`,
      `Readable extensions: ${[...readableExtensions].join(", ")}.`,
    );
  }
  return format;
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

export async function createWorkbookRoot(raw: string): Promise<WorkbookRoot> {
  const absolute = resolve(raw);
  let real: string;
  try {
    real = await realpath(absolute);
  } catch {
    throw new SkMcpExcelError(
      "file_not_found",
      `The workbook root '${raw}' does not exist.`,
    );
  }
  const info = await stat(real);
  if (!info.isDirectory()) {
    throw new SkMcpExcelError(
      "not_a_file",
      `The workbook root '${raw}' is not a directory.`,
    );
  }
  return { real };
}

async function canonicalEquivalent(target: string): Promise<string> {
  try {
    await stat(target);
    return target;
  } catch {
    const wanted = canonical(basename(target));
    const parent = dirname(target);
    const entries = await readdir(parent);
    const match = entries.find((entry) => canonical(entry) === wanted);
    if (match === undefined) {
      return target;
    }
    return join(parent, match);
  }
}

export async function resolveWorkbookPath(
  root: WorkbookRoot,
  requested: string,
): Promise<SandboxedPath> {
  if (requested === "" || requested.includes("\0")) {
    throw new SkMcpExcelError(
      "invalid_argument",
      "filePath must be a non-empty path without NUL bytes.",
      "Call list_workbooks to see readable files under the root.",
    );
  }
  const joined = isAbsolute(requested)
    ? requested
    : resolve(root.real, requested);
  if (!readableExtensions.has(asciiLower(extname(joined)))) {
    throw new SkMcpExcelError(
      "unsupported_extension",
      `'${requested}' is not a readable spreadsheet.`,
      `Readable extensions: ${[...readableExtensions].join(", ")}.`,
    );
  }
  const outside = new SkMcpExcelError(
    "path_outside_root",
    `'${requested}' resolves outside the workbook root.`,
    "Only files under the configured workbook root are readable.",
  );
  if (!isContained(root.real, joined)) {
    throw outside;
  }
  let real: string;
  try {
    real = await realpath(await canonicalEquivalent(joined));
  } catch {
    throw new SkMcpExcelError(
      "file_not_found",
      `No file at '${requested}' under the workbook root.`,
      "Call list_workbooks to see readable files under the root.",
    );
  }
  if (!isContained(root.real, real)) {
    throw outside;
  }
  return real as SandboxedPath;
}

export function assertReadableFormat(magic: Buffer, requested: string): void {
  if (
    magic.length >= 4 &&
    magic.subarray(0, 4).toString("hex") === "504b0304"
  ) {
    return;
  }
  if (
    magic.length >= 8 &&
    magic.subarray(0, 8).toString("hex") === "d0cf11e0a1b11ae1"
  ) {
    throw new SkMcpExcelError(
      "encrypted_workbook",
      `'${requested}' is password-protected or stored in the legacy binary format.`,
      "Save an unprotected copy in .xlsx format.",
    );
  }
  throw new SkMcpExcelError(
    "corrupt_workbook",
    `'${requested}' is not a valid .xlsx container.`,
    "Open the file in Excel and re-save it as .xlsx.",
  );
}

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

function mapDirectoryError(error: unknown, label: string): SkMcpExcelError {
  const errno = errnoOf(error);
  if (errno === "ENOENT") {
    return new SkMcpExcelError(
      "file_not_found",
      `No directory at '${label}' under the workbook root.`,
      "Call list_workbooks without subdirectory to see the readable files under the root.",
    );
  }
  if (errno === "ENOTDIR") {
    return new SkMcpExcelError(
      "not_a_file",
      `'${label}' is a file, not a directory.`,
      "Pass a folder under the workbook root, or omit subdirectory.",
    );
  }
  throw error;
}

export interface WorkbookEntry {
  readonly filePath: string;
  readonly sizeBytes: number;
  readonly modifiedAt: string;
}

export interface ListOptions {
  readonly subdirectory?: string;
  readonly pattern?: string;
  readonly maxResults: number;
}

export interface WorkbookListing {
  readonly files: readonly WorkbookEntry[];
  readonly total: number;
  readonly truncated: boolean;
  readonly unreadable?: number;
}

export async function listWorkbooks(
  root: WorkbookRoot,
  options: ListOptions,
): Promise<WorkbookListing> {
  const label = options.subdirectory ?? ".";
  const joined = options.subdirectory
    ? resolve(root.real, options.subdirectory)
    : root.real;
  const outside = new SkMcpExcelError(
    "path_outside_root",
    `'${options.subdirectory ?? ""}' resolves outside the workbook root.`,
    "Use a subdirectory inside the workbook root.",
  );
  if (!isContained(root.real, joined)) {
    throw outside;
  }
  let base: string;
  try {
    base = await realpath(joined);
  } catch (error) {
    throw mapDirectoryError(error, label);
  }
  if (!isContained(root.real, base)) {
    throw outside;
  }
  const matcher = globToRegExp(fold(options.pattern ?? "*"));
  let entries;
  try {
    entries = await readdir(base, { recursive: true, withFileTypes: true });
  } catch (error) {
    throw mapDirectoryError(error, label);
  }
  const candidates: string[] = [];
  for (const entry of entries) {
    if (candidates.length >= limits.maxListScan) {
      break;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) {
      continue;
    }
    if (!readableExtensions.has(asciiLower(extname(entry.name)))) {
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
  const files: WorkbookEntry[] = [];
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
