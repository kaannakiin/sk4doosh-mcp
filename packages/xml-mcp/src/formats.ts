import {
  createFormatRegistry,
  type FormatRegistry,
  type SourceExtension,
} from "@sk-mcp/file-core";
import { fail } from "./errors.js";
import { vocabulary } from "./vocabulary.js";

export type DocumentFormat = "xml";

const extensions = {
  ".xml": "xml",
  ".xsd": "xml",
  ".xhtml": "xml",
  ".svg": "xml",
  ".csproj": "xml",
  ".props": "xml",
  ".targets": "xml",
  ".config": "xml",
  ".resx": "xml",
} as const satisfies Readonly<Record<SourceExtension, DocumentFormat>>;

export const formats: FormatRegistry<DocumentFormat> =
  createFormatRegistry<DocumentFormat>(extensions, vocabulary, fail);
