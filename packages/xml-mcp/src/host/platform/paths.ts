import {
  createSandboxRoot,
  listSources,
  resolveSourcePath,
  type SandboxEnvironment,
  type SandboxRoot,
  type SourceEntry,
  type SourceListing,
} from "@sk-mcp/file-core";
import { fail } from "./errors.js";
import { formats } from "./formats.js";
import { limits } from "./limits.js";
import { vocabulary } from "./vocabulary.js";

export { isContained } from "@sk-mcp/file-core";
export type { ListOptions, SandboxedPath } from "@sk-mcp/file-core";

export type DocumentRoot = SandboxRoot;
export type DocumentEntry = SourceEntry;
export type DocumentListing = SourceListing;

const environment: SandboxEnvironment = {
  formats,
  vocabulary,
  fail,
  maxListScan: limits.maxListScan,
};

export async function createDocumentRoot(raw: string): Promise<DocumentRoot> {
  return createSandboxRoot(raw, environment);
}

export const resolveDocumentPath = resolveSourcePath;
export const listDocuments = listSources;
