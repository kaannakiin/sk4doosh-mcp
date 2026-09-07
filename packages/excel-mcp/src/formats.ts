import {
  createFormatRegistry,
  type FormatRegistry,
  type SourceExtension,
} from "@sk-mcp/file-core";
import { fail } from "./errors.js";
import { vocabulary } from "./vocabulary.js";

export type DocumentFormat = "xlsx" | "csv";

const extensions = {
  ".xlsx": "xlsx",
  ".xlsm": "xlsx",
  ".csv": "csv",
} as const satisfies Readonly<Record<SourceExtension, DocumentFormat>>;

export const formats: FormatRegistry<DocumentFormat> =
  createFormatRegistry<DocumentFormat>(extensions, vocabulary, fail);
