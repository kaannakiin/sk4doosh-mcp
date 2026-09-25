import { z } from "zod";

export const listWorkbooksInputSchema = z.object({});

export type ListWorkbooksInput = z.infer<typeof listWorkbooksInputSchema>;
