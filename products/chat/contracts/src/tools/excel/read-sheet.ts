import { z } from "zod";

import { rangeSchema, sheetNameSchema, workbookPathSchema } from "./shared.ts";

/**
 * Guard: these two numbers are sized against the context window, not against
 * what the reader can produce. Measured on a 2000x6 sheet with qwen3.8's
 * tokenizer: 4000 cells is ~11.4k tokens, the reader's own 2000-cell default is
 * ~5.9k, and 1200 cells is ~3.7k. The chat runs at `num_ctx` 16384, of which the
 * tool definitions and system prompt already take ~2.9k — so a single read at
 * 4000 cells leaves no room for the answer, let alone a second step. The
 * explicit `.default()` matters as much as the ceiling: without it an omitted
 * `maxCells` falls through to the reader's 2000 and silently costs 5.9k.
 *
 * `aggregate_sheet` answers the same question about that sheet in ~255 tokens,
 * which is why the instructions push the model there first.
 */
export const READ_SHEET_MAX_CELLS = 1500;

export const READ_SHEET_DEFAULT_CELLS = 1200;

export const readSheetInputSchema = z.object({
  filePath: workbookPathSchema,
  sheetName: sheetNameSchema,
  range: rangeSchema,
  maxCells: z
    .int()
    .min(1)
    .max(READ_SHEET_MAX_CELLS)
    .default(READ_SHEET_DEFAULT_CELLS)
    .describe(
      "Cells per response. Read a range or aggregate instead of raising this.",
    ),
  headerRow: z
    .int()
    .min(0)
    .optional()
    .describe("Row treated as headers, default 1. Pass 0 to disable headers."),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque token from a previous read_sheet response, to continue a truncated read. Cannot be combined with sheetName or range.",
    ),
});

export type ReadSheetInput = z.infer<typeof readSheetInputSchema>;
