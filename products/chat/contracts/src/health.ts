import { z } from "zod";

import { localeSchema } from "./locale.js";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  locale: localeSchema,
  uptimeSeconds: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
