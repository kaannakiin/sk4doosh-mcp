import { aggregateSheetInputSchema } from "./aggregate-sheet.ts";
import { describeWorkbookInputSchema } from "./describe-workbook.ts";
import { findInSheetInputSchema } from "./find-in-sheet.ts";
import { readSheetInputSchema } from "./read-sheet.ts";

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
} as const;

export type ExcelToolSchemas = typeof EXCEL_TOOL_SCHEMAS;
