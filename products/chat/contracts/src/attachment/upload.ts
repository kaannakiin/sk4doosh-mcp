import { z } from "zod";

import { attachmentSchema } from "./attachment.ts";

export const uploadResponseSchema = z.object({
  attachment: attachmentSchema,
  remainingFiles: z.int().nonnegative(),
  remainingBytes: z.int().nonnegative(),
});

export type UploadResponse = z.infer<typeof uploadResponseSchema>;

export const attachmentListResponseSchema = z.object({
  attachments: z.array(attachmentSchema),
});

export type AttachmentListResponse = z.infer<
  typeof attachmentListResponseSchema
>;
