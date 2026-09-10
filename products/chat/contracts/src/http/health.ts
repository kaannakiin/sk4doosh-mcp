import { z } from "zod";

import { localeSchema } from "../common/locale.ts";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  locale: localeSchema,
  uptimeSeconds: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
