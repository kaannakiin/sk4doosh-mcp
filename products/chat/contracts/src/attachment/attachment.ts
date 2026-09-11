import { z } from "zod";

import { mediaTypeSchema, readerFamilySchema } from "./media-type.ts";

export const attachmentIdSchema = z.uuid();

export type AttachmentId = z.infer<typeof attachmentIdSchema>;

export const attachmentSchema = z.object({
  id: attachmentIdSchema,
  filename: z.string().min(1),
  mediaType: mediaTypeSchema,
  family: readerFamilySchema,
  sandboxPath: z.string().min(1),
  bytes: z.int().nonnegative(),
  expiresAt: z.iso.datetime(),
});

export type Attachment = z.infer<typeof attachmentSchema>;
