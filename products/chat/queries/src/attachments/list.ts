import type { Attachment } from "@chat/contracts/attachment/attachment";
import { attachmentListResponseSchema } from "@chat/contracts/attachment/upload";
import type { SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";
import { queryOptions, useQuery } from "@tanstack/react-query";

import type { ChatClient } from "../client.ts";
import { chatKeys } from "../keys.ts";
import { withQuery } from "../path.ts";
import { useChatClient } from "../provider.tsx";
import { inAddedOrder } from "./order.ts";

const ATTACHMENT_STALE_TIME_MS = 60_000;

/**
 * A session's live attachments.
 *
 * @param initialData the list a session detail response already carried, so
 *   reopening a conversation does not re-ask for what it just received
 */
export function attachmentListOptions(
  client: ChatClient,
  sessionId: SessionId,
  locale: Locale,
  initialData?: readonly Attachment[],
) {
  return queryOptions({
    queryKey: chatKeys.attachments(sessionId),
    staleTime: ATTACHMENT_STALE_TIME_MS,
    ...(initialData === undefined
      ? {}
      : { initialData: inAddedOrder(initialData) }),
    queryFn: async ({ signal }): Promise<readonly Attachment[]> => {
      const response = await client.request(
        withQuery("/chat/files", { sessionId }),
        attachmentListResponseSchema,
        { locale, signal },
      );

      return inAddedOrder(response.attachments);
    },
  });
}

export function useAttachments(
  sessionId: SessionId,
  locale: Locale,
  initialData?: readonly Attachment[],
) {
  return useQuery(
    attachmentListOptions(useChatClient(), sessionId, locale, initialData),
  );
}
