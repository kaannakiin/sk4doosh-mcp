import { aggregateSheetInputSchema } from "./aggregate-sheet.ts";
import { describeWorkbookInputSchema } from "./describe-workbook.ts";
import { findInSheetInputSchema } from "./find-in-sheet.ts";
import { listWorkbooksInputSchema } from "./list-workbooks.ts";
import { readSheetInputSchema } from "./read-sheet.ts";
import { sheetStructureInputSchema } from "./sheet-structure.ts";

/**
 * The Excel reader's tool surface as this product exposes it, in the shape the
 * AI SDK's MCP client takes as `tools({ schemas })`.
 *
 * These are deliberate narrowings of the server's own schemas, not copies. The
 * server accepts around fifteen further optional fields per tool (cursor
 * inheritance policy, CSV delimiter and encoding overrides, merged-cell and
 * header-scan modes); handing all of them to a small local model buys nothing
 * and costs tool-selection accuracy. Declaring the schemas here rather than
 * discovering them also keeps the UI on typed `tool-<name>` parts instead of the
 * generic `dynamic-tool` part, and keeps every schema in the contract layer.
 */
export const EXCEL_TOOL_SCHEMAS = {
  describe_workbook: { inputSchema: describeWorkbookInputSchema },
  read_sheet: { inputSchema: readSheetInputSchema },
  aggregate_sheet: { inputSchema: aggregateSheetInputSchema },
  find_in_sheet: { inputSchema: findInSheetInputSchema },
  list_workbooks: { inputSchema: listWorkbooksInputSchema },
  get_tables: { inputSchema: sheetStructureInputSchema },
  get_data_validations: { inputSchema: sheetStructureInputSchema },
  get_merged_ranges: { inputSchema: sheetStructureInputSchema },
  get_conditional_formats: { inputSchema: sheetStructureInputSchema },
  get_images: { inputSchema: sheetStructureInputSchema },
} as const;

export type ExcelToolSchemas = typeof EXCEL_TOOL_SCHEMAS;
