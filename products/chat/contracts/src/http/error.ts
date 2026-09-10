import { z } from "zod";

export const validationIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  code: z.string(),
  message: z.string(),
});

export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  issues: z.array(validationIssueSchema).optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
