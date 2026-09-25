import { z } from "zod";

import { pdfPathSchema } from "./shared.ts";

export const describePdfInputSchema = z.object({
  filePath: pdfPathSchema,
});

export type DescribePdfInput = z.infer<typeof describePdfInputSchema>;
