import { z } from "zod";

import { sheetNameSchema, workbookPathSchema } from "./shared.ts";

export const sheetStructureInputSchema = z.object({
  filePath: workbookPathSchema,
  sheetName: sheetNameSchema,
});

export type SheetStructureInput = z.infer<typeof sheetStructureInputSchema>;
