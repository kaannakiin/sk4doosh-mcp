import { z } from "zod";

import { PDF_MAX_READ_PAGES, pdfPathSchema } from "./shared.ts";

export const readPdfPagesInputSchema = z.object({
  filePath: pdfPathSchema,
  pages: z
    .array(z.int().min(1))
    .min(1)
    .max(PDF_MAX_READ_PAGES)
    .optional()
    .describe(
      "Page numbers to read, counted from 1. Omit to read from the first page.",
    ),
  maxPages: z
    .int()
    .min(1)
    .max(PDF_MAX_READ_PAGES)
    .optional()
    .describe("Maximum pages in one response, default 10."),
  ocr: z
    .boolean()
    .optional()
    .describe(
      "Transcribe pages that have no readable text, default false. Slow; use it only for pages describe_pdf listed as needing OCR, and only when capabilities.ocr is true.",
    ),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque token from a previous read_pdf_pages response, to continue a truncated read. Cannot be combined with pages.",
    ),
});

export type ReadPdfPagesInput = z.infer<typeof readPdfPagesInputSchema>;
