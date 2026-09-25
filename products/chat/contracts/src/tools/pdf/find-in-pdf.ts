import { z } from "zod";

import {
  PDF_MAX_FIND_RESULTS,
  PDF_MAX_QUERY_CHARS,
  pdfPathSchema,
} from "./shared.ts";

export const findInPdfInputSchema = z.object({
  filePath: pdfPathSchema,
  query: z
    .string()
    .min(1)
    .max(PDF_MAX_QUERY_CHARS)
    .describe(
      "Literal text to look for. Never treated as a regular expression.",
    ),
  caseSensitive: z
    .boolean()
    .optional()
    .describe("Default true. When false, only ASCII letters are folded."),
  maxResults: z
    .int()
    .min(1)
    .max(PDF_MAX_FIND_RESULTS)
    .optional()
    .describe("Maximum matches in one response, default 50."),
  ocr: z
    .boolean()
    .optional()
    .describe(
      "Transcribe unsearchable pages before searching, default false. Slow; use it only when capabilities.ocr is true and a previous search reported coverageComplete false.",
    ),
  cursor: z
    .string()
    .optional()
    .describe("Opaque token from a previous find_in_pdf response."),
});

export type FindInPdfInput = z.infer<typeof findInPdfInputSchema>;
