import { classifyContainerMagic } from "@sk-mcp/ooxml-core";
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
  const kind = classifyContainerMagic(magic);
  if (kind === "zip") return;
  if (kind === "cfb") {
    throw new SkMcpExcelError(
      "encrypted_workbook",
      `'${requested}' is password-protected or stored in the legacy binary format.`,
      "Save an unprotected copy in .xlsx format.",
    );
  }
  throw new SkMcpExcelError(
    "not_a_workbook",
    `'${requested}' is not a .xlsx container; it does not begin with a zip header.`,
    "Check what the file really is; the extension does not match its content.",
  );
}
