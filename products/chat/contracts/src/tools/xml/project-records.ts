import { z } from "zod";

import {
  addressStepSchema,
  documentPathSchema,
  expandedNameSchema,
  XML_MAX_DEPTH,
} from "./shared.ts";

export const PROJECT_MAX_COLUMNS = 32;

export const PROJECT_MAX_COLUMN_DEPTH = 16;

export const PROJECT_MAX_CONDITIONS = 16;

export const PROJECT_MAX_ROWS = 200;

export const itemAddressSchema = z
  .object({
    ancestors: z.array(addressStepSchema).min(1).max(XML_MAX_DEPTH),
    name: expandedNameSchema.describe(
      "Expanded name of the repeated child. Every child of the holder with this name is one record.",
    ),
  })
  .describe(
    "The record set: singular ancestors plus one repeated child name, as returned by describe_document.",
  );

export type ItemAddress = z.infer<typeof itemAddressSchema>;

export const columnValueSchema = z.discriminatedUnion("from", [
  z.object({ from: z.literal("text") }),
  z.object({
    from: z.literal("attribute"),
    namespaceUri: z.string(),
    localName: z.string().min(1),
  }),
  z.object({ from: z.literal("name") }),
]);

export const projectColumnSchema = z.object({
  label: z.string().min(1).max(64).describe("Unique name for this column."),
  ancestors: z
    .array(addressStepSchema)
    .max(PROJECT_MAX_COLUMN_DEPTH)
    .optional()
    .describe("Singular path from the record element, default the record."),
  name: expandedNameSchema
    .optional()
    .describe(
      "Terminal child name. Omit to read the addressed element itself.",
    ),
  value: columnValueSchema
    .optional()
    .describe("text (default), attribute, or name."),
  onMultiple: z
    .enum(["error", "list", "first"])
    .optional()
    .describe("Several matches in one record: error (default), list or first."),
});

export type ProjectColumn = z.infer<typeof projectColumnSchema>;

export const projectConditionSchema = z.object({
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
  values: z.array(z.string()).min(1).max(64).optional(),
});

export const projectRecordsInputSchema = z.object({
  filePath: documentPathSchema,
  itemAddress: itemAddressSchema,
  columns: z.array(projectColumnSchema).min(1).max(PROJECT_MAX_COLUMNS),
  where: z
    .array(projectConditionSchema)
    .max(PROJECT_MAX_CONDITIONS)
    .optional()
    .describe("Row filter over declared columns. Comparisons are textual."),
  match: z.enum(["all", "any"]).optional(),
  caseSensitive: z.boolean().optional(),
  maxRows: z
    .int()
    .min(1)
    .max(PROJECT_MAX_ROWS)
    .default(50)
    .describe("Maximum rows in one page."),
  cursor: z
    .string()
    .optional()
    .describe("Opaque token from a previous project_records response."),
});

export type ProjectRecordsInput = z.infer<typeof projectRecordsInputSchema>;
