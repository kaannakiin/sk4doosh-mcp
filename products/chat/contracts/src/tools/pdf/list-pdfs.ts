import { z } from "zod";

export const listPdfsInputSchema = z.object({});

export type ListPdfsInput = z.infer<typeof listPdfsInputSchema>;
