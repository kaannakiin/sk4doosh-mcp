import { z } from "zod";

import { workbookPathSchema } from "./shared.ts";

export const describeWorkbookInputSchema = z.object({
  filePath: workbookPathSchema,
});

export type DescribeWorkbookInput = z.infer<typeof describeWorkbookInputSchema>;
