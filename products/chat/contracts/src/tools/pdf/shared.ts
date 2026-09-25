import { z } from "zod";

export const PDF_MAX_READ_PAGES = 50;

export const PDF_MAX_FIND_RESULTS = 200;

export const PDF_MAX_QUERY_CHARS = 256;

export const pdfPathSchema = z
  .string()
  .min(1)
  .describe("Attachment path exactly as listed in the attachment manifest.");
