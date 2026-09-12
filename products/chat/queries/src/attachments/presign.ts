import type { AttachmentId } from "@chat/contracts/attachment/attachment";
import {
  presignedUrlResponseSchema,
  type PresignDisposition,
} from "@chat/contracts/attachment/presign";
import type { SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";
import { queryOptions, useQuery } from "@tanstack/react-query";

import type { ChatClient } from "../client.ts";
import { chatKeys } from "../keys.ts";
import { attachmentPath, withQuery } from "../path.ts";
import { useChatClient } from "../provider.tsx";

/** How long a signed url survives after nothing renders it any more. */
const PRESIGN_GC_MS = 30_000;

export interface PresignParams {
  sessionId: SessionId;
  attachmentId: AttachmentId;
  disposition: PresignDisposition;
  locale: Locale;
  enabled?: boolean;
}

/**
 * A short-lived url for one attachment.
 *
 * Guard: a mounted url is never re-signed. Each signature is a different query
 * string, so the browser treats a re-signed url as a new resource and downloads
 * the bytes again — which turns an image thumbnail into a repeated download on
 * every render pass that revalidates. `gcTime` is what bounds the staleness: the
 * entry is dropped shortly after nothing renders it, so the next mount signs
 * afresh, and a url that does lapse while on screen is recovered by the caller
 * invalidating this key on a load error.
 *
 * Guard: a caller that needs a guaranteed-live url — a download the visitor just
 * clicked — overrides `staleTime` to `0` at its `fetchQuery` call instead of
 * weakening this default for the thumbnails.
 *
 * Guard: `inline` is only ever granted for an allow-listed image type; asking
 * for it on anything else is answered `not_previewable`, and that is a caller
 * bug rather than a retryable failure.
 */
export function presignOptions(
  client: ChatClient,
  { sessionId, attachmentId, disposition, locale, enabled = true }: PresignParams,
) {
  return queryOptions({
    queryKey: chatKeys.presign(sessionId, attachmentId, disposition),
    enabled,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: PRESIGN_GC_MS,
    queryFn: ({ signal }) =>
      client.request(
        withQuery(attachmentPath(attachmentId, "/url"), {
          sessionId,
          disposition,
        }),
        presignedUrlResponseSchema,
        { locale, signal },
      ),
  });
}

export function usePresignedUrl(params: PresignParams) {
  return useQuery(presignOptions(useChatClient(), params));
}
