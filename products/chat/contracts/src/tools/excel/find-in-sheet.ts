import { z } from "zod";

import { rangeSchema, sheetNameSchema, workbookPathSchema } from "./shared.ts";

export const FIND_MAX_RESULTS = 100;

export const FIND_DEFAULT_RESULTS = 50;

export const findInSheetInputSchema = z.object({
  filePath: workbookPathSchema,
  query: z.string().min(1),
  sheetName: sheetNameSchema,
  range: rangeSchema,
  matchMode: z
    .enum(["contains", "exact"])
    .optional()
    .describe("Contains (default) or exact text."),
  caseSensitive: z
    .boolean()
    .optional()
    .describe("Case-sensitive matching, default false."),
  maxResults: z
    .int()
    .min(1)
    .max(FIND_MAX_RESULTS)
    .default(FIND_DEFAULT_RESULTS)
    .describe("Maximum returned matches."),
});

export type FindInSheetInput = z.infer<typeof findInSheetInputSchema>;
