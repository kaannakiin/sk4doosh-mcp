import { z } from "zod";

import { documentPathSchema } from "./shared.ts";

export const XPATH_MAX_CHARS = 4096;

export const XPATH_MAX_RESULTS = 200;

export const XPATH_MAX_NAMESPACE_BINDINGS = 32;

export const namespaceBindingSchema = z.object({
  prefix: z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/u),
  uri: z.string().min(1),
});

export type NamespaceBinding = z.infer<typeof namespaceBindingSchema>;

export const selectXpathInputSchema = z.object({
  filePath: documentPathSchema,
  xpath: z
    .string()
    .min(1)
    .max(XPATH_MAX_CHARS)
    .describe("XPath 1.0 expression. Nothing from XPath 2.0 or later works."),
  namespaces: z
    .array(namespaceBindingSchema)
    .max(XPATH_MAX_NAMESPACE_BINDINGS)
    .optional()
    .describe(
      "Prefix bindings for the expression. A prefix used but not bound is an error.",
    ),
  maxResults: z
    .int()
    .min(1)
    .max(XPATH_MAX_RESULTS)
    .default(50)
    .describe("Maximum node-set members in one page."),
  cursor: z
    .string()
    .optional()
    .describe("Opaque token from a previous select_xpath response."),
});

export type SelectXpathInput = z.infer<typeof selectXpathInputSchema>;
