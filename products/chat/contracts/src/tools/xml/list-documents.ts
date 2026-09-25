import { z } from "zod";

export const listDocumentsInputSchema = z.object({});

export type ListDocumentsInput = z.infer<typeof listDocumentsInputSchema>;
