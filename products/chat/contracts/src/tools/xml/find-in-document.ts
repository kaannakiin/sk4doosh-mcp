import { z } from "zod";

import { addressSchema, documentPathSchema } from "./shared.ts";

export const XML_FIND_MAX_RESULTS = 100;

export const findInDocumentInputSchema = z.object({
  filePath: documentPathSchema,
  query: z
    .string()
    .min(1)
    .describe("Literal text to look for. Case-sensitive; not a pattern."),
  matchMode: z
    .enum(["contains", "exact"])
    .optional()
    .describe("Substring match (default) or whole-value equality."),
  searchIn: z
    .enum(["text", "attributes", "both"])
    .optional()
    .describe("Search text nodes (default), attribute values, or both."),
  scopeAddress: addressSchema
    .optional()
    .describe("Restrict the scan to this element's subtree."),
  maxResults: z
    .int()
    .min(1)
    .max(XML_FIND_MAX_RESULTS)
    .default(50)
    .describe("Maximum matches in one page."),
  cursor: z
    .string()
    .optional()
    .describe(
      "Opaque token from a previous find_in_document response. Cannot be combined with scopeAddress.",
    ),
});

export type FindInDocumentInput = z.infer<typeof findInDocumentInputSchema>;
