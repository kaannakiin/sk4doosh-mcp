import { z } from "zod";

import {
  columnRefSchema,
  rangeSchema,
  sheetNameSchema,
  workbookPathSchema,
} from "./shared.ts";

export const AGGREGATE_MAX_METRICS = 8;

export const AGGREGATE_MAX_CONDITIONS = 16;

export const AGGREGATE_MAX_GROUPS = 500;

export const aggregateMetricSchema = z.object({
  fn: z.enum([
    "count",
    "countValues",
    "countDistinct",
    "sum",
    "avg",
    "min",
    "max",
    "stddev",
  ]),
  column: columnRefSchema
    .optional()
    .describe("Required for every metric except count."),
});

export type AggregateMetric = z.infer<typeof aggregateMetricSchema>;

const operandSchema = z.union([z.string(), z.number(), z.boolean()]);

export const aggregateConditionSchema = z.object({
  column: columnRefSchema,
  op: z.enum([
    "eq",
    "ne",
    "lt",
    "lte",
    "gt",
    "gte",
    "contains",
    "startsWith",
    "endsWith",
    "in",
    "between",
    "isEmpty",
    "isNotEmpty",
    "isError",
    "isNumber",
    "isText",
  ]),
  value: operandSchema.optional(),
  values: z.array(operandSchema).min(1).max(64).optional(),
});

export type AggregateCondition = z.infer<typeof aggregateConditionSchema>;

export const aggregateSheetInputSchema = z.object({
  filePath: workbookPathSchema,
  sheetName: sheetNameSchema,
  range: rangeSchema,
  groupBy: z
    .array(columnRefSchema)
    .max(AGGREGATE_MAX_METRICS)
    .optional()
    .describe("Columns to group by. Omit for a single whole-range total."),
  metrics: z.array(aggregateMetricSchema).min(1).max(AGGREGATE_MAX_METRICS),
  where: z
    .array(aggregateConditionSchema)
    .max(AGGREGATE_MAX_CONDITIONS)
    .optional()
    .describe("Row filter."),
  match: z
    .enum(["all", "any"])
    .optional()
    .describe("Combine the row filter with all (default) or any."),
  maxGroups: z
    .int()
    .min(1)
    .max(AGGREGATE_MAX_GROUPS)
    .default(50)
    .describe("Maximum groups returned."),
});

export type AggregateSheetInput = z.infer<typeof aggregateSheetInputSchema>;
