import { z } from "zod";

export const XML_MAX_DEPTH = 128;

export const documentPathSchema = z
  .string()
  .min(1)
  .describe("Attachment path exactly as listed in the attachment manifest.");

export const addressStepSchema = z.object({
  namespaceUri: z
    .string()
    .describe("Namespace URI of the element. Empty string means no namespace."),
  localName: z.string().min(1),
  occurrence: z
    .int()
    .min(1)
    .optional()
    .describe(
      "1-based position among element siblings sharing this name, default 1.",
    ),
});

export type AddressStep = z.infer<typeof addressStepSchema>;

export const addressSchema = z
  .array(addressStepSchema)
  .max(XML_MAX_DEPTH)
  .describe(
    "Segment path from the document element inclusive, as returned by describe_document. Not an XPath expression.",
  );

export const expandedNameSchema = z.object({
  namespaceUri: z.string(),
  localName: z.string().min(1),
});
