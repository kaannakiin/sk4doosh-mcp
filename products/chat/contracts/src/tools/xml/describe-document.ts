import { z } from "zod";

import { documentPathSchema } from "./shared.ts";

export const DESCRIBE_MAX_PATHS = 200;

export const describeDocumentInputSchema = z.object({
  filePath: documentPathSchema,
  maxPaths: z
    .int()
    .min(1)
    .max(DESCRIBE_MAX_PATHS)
    .default(20)
    .describe("Maximum repetition candidates returned."),
});

export type DescribeDocumentInput = z.infer<typeof describeDocumentInputSchema>;
