import type { SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";
import type { AttachedFile } from "@chat/queries/chat/attached-files";
import { usePresignedUrl } from "@chat/queries/attachments/presign";
import { chatKeys } from "@chat/queries/keys";
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import { AttachmentGlyph } from "./attachment-icon";

export interface AttachmentThumbProps {
  readonly sessionId: SessionId;
  readonly locale: Locale;
  readonly attachment: AttachedFile;
}

/**
 * The image itself, in place of a generic glyph.
 *
 * Guard: a failed load re-signs once, then gives up and falls back to the glyph.
 * A signed url can lapse while the strip stays mounted, and invalidating on
 * every error without a bound turns an object the api can no longer serve — a
 * deleted one, say — into an endless sign-and-fail loop.
 */
export function AttachmentThumb({
  sessionId,
  locale,
  attachment,
}: AttachmentThumbProps) {
  const queryClient = useQueryClient();
  const resigned = useRef(false);
  const presigned = usePresignedUrl({
    sessionId,
    attachmentId: attachment.id,
    disposition: "inline",
    locale,
  });

  if (presigned.data === undefined) {
    return <AttachmentGlyph mediaType={attachment.mediaType} />;
  }

  return (
    <img
      className="size-7 shrink-0 rounded-[5px] bg-hairline object-cover"
      src={presigned.data.url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => {
        if (resigned.current) {
          return;
        }
        resigned.current = true;
        void queryClient.invalidateQueries({
          queryKey: chatKeys.presign(sessionId, attachment.id, "inline"),
        });
      }}
    />
  );
}
