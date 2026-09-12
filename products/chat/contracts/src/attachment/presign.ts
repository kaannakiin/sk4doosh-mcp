import { z } from "zod";

import { mediaTypeSchema } from "./media-type.ts";

export const presignDispositionSchema = z.enum(["inline", "attachment"]);

export type PresignDisposition = z.infer<typeof presignDispositionSchema>;

/**
 * Guard: a caller may only *ask* for `inline`. The server grants it solely for an
 * allow-listed image type and answers `not_previewable` otherwise, rather than
 * quietly downgrading — a UI bug should be loud, not a mystery download.
 */
export const presignQuerySchema = z.object({
  sessionId: z.uuid(),
  disposition: presignDispositionSchema.default("attachment"),
});

export type PresignQuery = z.infer<typeof presignQuerySchema>;

export const presignedUrlResponseSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
  disposition: presignDispositionSchema,
  mediaType: mediaTypeSchema,
});

export type PresignedUrlResponse = z.infer<typeof presignedUrlResponseSchema>;
