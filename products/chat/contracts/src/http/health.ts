import { z } from "zod";

import { localeSchema } from "../common/locale.ts";

export const readinessSchema = z.enum(["ready", "unconfigured", "failed"]);

export type Readiness = z.infer<typeof readinessSchema>;

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  locale: localeSchema,
  uptimeSeconds: z.number().nonnegative(),
  llm: z.object({
    model: z.string(),
    status: readinessSchema,
    detail: z.string().optional(),
  }),
  readers: z.object({
    workbook: readinessSchema,
    document: readinessSchema,
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
