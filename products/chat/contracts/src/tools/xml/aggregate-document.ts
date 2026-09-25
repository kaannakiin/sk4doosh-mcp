import { z } from "zod";

import {
  itemAddressSchema,
  PROJECT_MAX_COLUMNS,
  PROJECT_MAX_CONDITIONS,
  projectColumnSchema,
  projectConditionSchema,
} from "./project-records.ts";
import { documentPathSchema } from "./shared.ts";

export const XML_AGGREGATE_MAX_METRICS = 8;

export const XML_AGGREGATE_MAX_GROUPS = 200;

export const xmlAggregateMetricSchema = z.object({
  fn: z.enum([
    "count",
    "countValues",
    "countDistinct",
    "sum",
    "avg",
    "min",
    "max",
  ]),
  column: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Label of a declared column. Required for every metric except count.",
    ),
});

export const aggregateDocumentInputSchema = z.object({
  filePath: documentPathSchema,
  itemAddress: itemAddressSchema,
  columns: z.array(projectColumnSchema).min(1).max(PROJECT_MAX_COLUMNS),
  groupBy: z
    .array(z.string().min(1))
    .max(XML_AGGREGATE_MAX_METRICS)
    .optional()
    .describe(
      "Labels of declared columns to group by. Omit for one whole-set total.",
    ),
  metrics: z
    .array(xmlAggregateMetricSchema)
    .min(1)
    .max(XML_AGGREGATE_MAX_METRICS),
  where: z
    .array(projectConditionSchema)
    .max(PROJECT_MAX_CONDITIONS)
    .optional()
    .describe("Row filter over declared columns. Comparisons are textual."),
  match: z.enum(["all", "any"]).optional(),
  numericMode: z
    .enum(["off", "binary64"])
    .optional()
    .describe(
      "off (default) offers only the counting metrics. binary64 enables sum, avg, min and max.",
    ),
  maxGroups: z
    .int()
    .min(1)
    .max(XML_AGGREGATE_MAX_GROUPS)
    .default(50)
    .describe("Maximum groups returned."),
});

export type AggregateDocumentInput = z.infer<
  typeof aggregateDocumentInputSchema
>;
