import {
  createSandboxRoot,
  listSources,
  resolveSourcePath,
  type SandboxEnvironment,
  type SandboxRoot,
  type SourceEntry,
  type SourceListing,
} from "@sk-mcp/file-core";
import { SkMcpExcelError, fail } from "./errors.js";
import { formats } from "./formats.js";
import { limits } from "./limits.js";
import { vocabulary } from "./vocabulary.js";

export { isContained } from "@sk-mcp/file-core";
export type { ListOptions, SandboxedPath } from "@sk-mcp/file-core";

export type WorkbookRoot = SandboxRoot;
export type WorkbookEntry = SourceEntry;
export type WorkbookListing = SourceListing;

const environment: SandboxEnvironment = {
  formats,
  vocabulary,
  fail,
  maxListScan: limits.maxListScan,
};

export async function createWorkbookRoot(raw: string): Promise<WorkbookRoot> {
  return createSandboxRoot(raw, environment);
}

export const resolveWorkbookPath = resolveSourcePath;
export const listWorkbooks = listSources;

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
