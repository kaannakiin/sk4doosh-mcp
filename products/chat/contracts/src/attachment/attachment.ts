import { z } from "zod";

import { mediaTypeSchema, readerFamilySchema } from "./media-type.ts";
import { sandboxPathSchema } from "./object-key.ts";

export const attachmentIdSchema = z.uuid();

export type AttachmentId = z.infer<typeof attachmentIdSchema>;

/**
 * Guard: `family` and `sandboxPath` are null exactly for images, and that pairing
 * is a database invariant rather than a convention — an image has no reader
 * process and is never materialized into the directory the readers are rooted
 * at. There is no `expiresAt` any more: objects and rows are retained
 * indefinitely and only the local cache is reaped, so the field would be a lie
 * the interface renders.
 */
export const attachmentSchema = z.object({
  id: attachmentIdSchema,
  filename: z.string().min(1),
  mediaType: mediaTypeSchema,
  family: readerFamilySchema.nullable(),
  sandboxPath: sandboxPathSchema.nullable(),
  bytes: z.int().nonnegative(),
  createdAt: z.iso.datetime(),
});

export type Attachment = z.infer<typeof attachmentSchema>;
