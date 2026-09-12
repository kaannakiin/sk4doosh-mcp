import type { Attachment } from "@chat/contracts/attachment/attachment";
import {
  attachmentListResponseSchema,
  uploadResponseSchema,
  type UploadResponse,
} from "@chat/contracts/attachment/upload";
import type { SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { chatKeys } from "../keys.ts";
import { attachmentPath, withQuery } from "../path.ts";
import { useChatClient } from "../provider.tsx";
import { inAddedOrder } from "./order.ts";

/**
 * Uploads one file to a session.
 *
 * Guard: the upload response carries the stored row, so the list cache is
 * written from it rather than invalidated. Re-fetching here would race the
 * session's next turn, which reads the same list server side to decide which
 * reader families to connect.
 */
export function useUploadAttachment(sessionId: SessionId, locale: Locale) {
  const client = useChatClient();
  const queryClient = useQueryClient();

  return useMutation<UploadResponse, Error, File>({
    mutationKey: chatKeys.attachmentUploads(sessionId),
    mutationFn: (file) => {
      const form = new FormData();
      /**
       * Guard: the name is passed explicitly. Without it the browser sends the
       * part as "blob" and the stored filename is lost.
       */
      form.append("file", file, file.name);

      return client.request(
        withQuery("/chat/files", { sessionId }),
        uploadResponseSchema,
        { method: "POST", locale, body: form },
      );
    },
    onSuccess: ({ attachment }) => {
      queryClient.setQueryData<readonly Attachment[]>(
        chatKeys.attachments(sessionId),
        (attachments) => inAddedOrder([...(attachments ?? []), attachment]),
      );
    },
  });
}

export function useRemoveAttachment(sessionId: SessionId, locale: Locale) {
  const client = useChatClient();
  const queryClient = useQueryClient();

  return useMutation<readonly Attachment[], Error, string>({
    mutationFn: async (attachmentId) => {
      const response = await client.request(
        withQuery(attachmentPath(attachmentId), { sessionId }),
        attachmentListResponseSchema,
        { method: "DELETE", locale },
      );

      return inAddedOrder(response.attachments);
    },
    onSuccess: (attachments) => {
      queryClient.setQueryData(chatKeys.attachments(sessionId), attachments);
    },
  });
}
