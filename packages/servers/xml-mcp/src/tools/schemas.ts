import { z } from "zod";

import { limits } from "../host/platform/limits.js";

export const filePath = z
  .string()
  .describe(
    "Document path relative to the root, as returned by list_documents.",
  );

export const addressStep = z.object({
  namespaceUri: z
    .string()
    .describe("Namespace URI of the element. Empty string means no namespace."),
  localName: z.string().min(1).describe("Local name of the element."),
  occurrence: z
    .int()
    .min(1)
    .optional()
    .describe(
      "1-based position among element siblings sharing this expanded name, default 1.",
    ),
});

export const address = z
  .array(addressStep)
  .max(limits.maxDomDepth)
  .describe(
    "Segment path from the document element inclusive. Not an XPath expression; describe_document returns one you can pass straight back.",
  );

const expandedName = z.object({
  namespaceUri: z
    .string()
    .describe("Namespace URI of the element. Empty string means no namespace."),
  localName: z.string().min(1).describe("Local name of the element."),
});

export const namespaceBindings = z
  .array(
    z.object({
      prefix: z
        .string()
        .regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/u)
        .describe(
          "Prefix as written in the expression. Use the alias describe_document returned.",
        ),
      uri: z.string().min(1).describe("Namespace URI the prefix stands for."),
    }),
  )
  .max(limits.maxNamespaceBindings)
  .describe(
    "Prefix bindings for the expression. A prefix used but not bound is an error; the expression is never rewritten to guess one.",
  );

export const itemAddress = z
  .object({
    ancestors: z
      .array(addressStep)
      .min(1)
      .max(limits.maxDomDepth)
      .describe(
        "Singular path to the element that holds the records, from the document element inclusive.",
      ),
    name: expandedName.describe(
      "Expanded name of the repeated child. Every child of the holder with this name is one record.",
    ),
  })
  .describe(
    "The record set: singular ancestors plus one repeated child name. This is not an XPath expression and the wildcard applies to the repeated child only.",
  );

export const columns = z
  .array(
    z.object({
      label: z
        .string()
        .min(1)
        .max(64)
        .describe("Name for this column in the response. Must be unique."),
      ancestors: z
        .array(addressStep)
        .max(limits.maxColumnDepth)
        .optional()
        .describe(
          "Singular path from the record element, default the record itself.",
        ),
      name: expandedName
        .optional()
        .describe(
          "Terminal child name. Every child with this name is a candidate, which is what onMultiple decides about. Omit to read the addressed element itself.",
        ),
      value: z
        .discriminatedUnion("from", [
          z.object({ from: z.literal("text") }),
          z.object({
            from: z.literal("attribute"),
            namespaceUri: z.string(),
            localName: z.string().min(1),
          }),
          z.object({ from: z.literal("name") }),
        ])
        .optional()
        .describe(
          "text (default) joins the element's own text and CDATA children without descending, and marks the cell mixed when the element also has element children; attribute reads one attribute; name reads the local name.",
        ),
      onMultiple: z
        .enum(["error", "list", "first"])
        .optional()
        .describe(
          "Several matches in one record: error (default) marks that cell multiple with a count and no value, list returns the values, first takes the first. No policy silently picks one.",
        ),
    }),
  )
  .min(1)
  .max(limits.maxColumns);

export const where = z
  .array(
    z.object({
      column: z.string().min(1).describe("Label of a declared column."),
      op: z.enum([
        "eq",
        "ne",
        "contains",
        "startsWith",
        "endsWith",
        "in",
        "isEmpty",
        "isNotEmpty",
        "isMissing",
        "isPresent",
      ]),
      value: z.string().optional(),
      values: z.array(z.string()).min(1).max(limits.maxInValues).optional(),
    }),
  )
  .max(limits.maxConditions)
  .describe(
    "Row filter over declared columns. Comparisons are textual: a multiple cell never matches one, and no value is converted to a number.",
  );

export const match = z
  .enum(["all", "any"])
  .optional()
  .describe("Combine conditions with all (default) or any.");

export const caseSensitive = z
  .boolean()
  .optional()
  .describe(
    "Case-sensitive comparison, default true. XML names and values are case-sensitive; false lowercases both sides and does not fold accents.",
  );
