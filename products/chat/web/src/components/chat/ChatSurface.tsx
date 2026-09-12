import type { SessionId } from "@chat/contracts/chat/session";
import type { Locale } from "@chat/contracts/common/locale";
import { useUploadAttachment } from "@chat/queries/attachments/mutations";
import { useAttachments } from "@chat/queries/attachments/list";
import { usePendingUploads } from "@chat/queries/attachments/pending";
import {
  attachedFilesPart,
  unsentAttachments,
} from "@chat/queries/chat/attached-files";
import { useChatSession } from "@chat/queries/chat/use-chat-session";
import type { SessionView } from "@chat/queries/sessions/detail";
import { Alert } from "@mantine/core";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { AttachmentStrip } from "./AttachmentStrip";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import { MessageList } from "./MessageList";

export interface ChatSurfaceProps {
  readonly sessionId: SessionId;
  readonly locale: Locale;
  readonly view: SessionView;
}

/**
 * Guard: the caller mounts this keyed on `sessionId`, and only once the history
 * has arrived. `useChat` reads its initial messages exactly once per chat id, so
 * a surface that is reused across conversations keeps the previous one's turns.
 */
export function ChatSurface({ sessionId, locale, view }: ChatSurfaceProps) {
  const { t } = useTranslation();
  const attachments = useAttachments(sessionId, locale, view.attachments);
  const pending = usePendingUploads(sessionId);
  const upload = useUploadAttachment(sessionId, locale);

  const { messages, sendMessage, status, stop, error, clearError, addToolApprovalResponse } =
    useChatSession({
      sessionId,
      locale,
      initialMessages: view.messages,
      session: view.session,
      attachmentCount: view.attachments.length,
    });

  const busy = status === "submitted" || status === "streaming";

  /**
   * Guard: derived from the turns on screen rather than kept in state. A file is
   * stored against the session the moment it is dropped, so "still in the
   * composer" means only that no turn has recorded it yet — and that answer has
   * to survive a reload, which a `useState` list would not.
   */
  const staged = unsentAttachments(messages, attachments.data ?? []);

  const onDrop = useCallback(
    (files: readonly File[]) => {
      for (const file of files) {
        upload.mutate(file);
      }
    },
    [upload],
  );

  const onDecision = useCallback(
    (id: string, approved: boolean) => {
      void addToolApprovalResponse({ id, approved });
    },
    [addToolApprovalResponse],
  );

  /**
   * Guard: the files ride along as a data part rather than as the SDK's `file`
   * parts. `convertToModelMessages` turns a file part into model content and
   * parses its url, which an xlsx behind a session-scoped id is not; a data part
   * is dropped before the prompt is built, so the turn keeps its record of what
   * was attached without offering the model a second, weaker way to reach it
   * than the reader tools.
   */
  const onSend = useCallback(
    (text: string) => {
      void sendMessage({
        parts: [
          ...(staged.length > 0 ? [attachedFilesPart(staged)] : []),
          { type: "text", text },
        ],
      });
    },
    [sendMessage, staged],
  );

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      {messages.length === 0 ? (
        <EmptyState />
      ) : (
        <MessageList
          sessionId={sessionId}
          messages={messages}
          streaming={status === "streaming"}
          pending={status === "submitted"}
          truncated={view.truncated}
          onDecision={onDecision}
        />
      )}

      <div className="border-t border-hairline bg-surface">
        {error === undefined ? null : (
          <Alert
            color="red"
            variant="light"
            withCloseButton
            className="mx-auto mt-3 max-w-measure py-2"
            closeButtonLabel={t("errors.dismiss")}
            onClose={clearError}
          >
            {error.message.length > 0 ? error.message : t("errors.network")}
          </Alert>
        )}

        {upload.isError ? (
          <Alert color="red" variant="light" className="mx-auto mt-3 max-w-measure py-2">
            {upload.error.message}
          </Alert>
        ) : null}

        <Composer
          busy={busy}
          attached={staged.length > 0 || pending.length > 0}
          onSend={onSend}
          onStop={stop}
          onDrop={onDrop}
        >
          <AttachmentStrip
            sessionId={sessionId}
            locale={locale}
            files={staged}
            pending={pending}
            removable
          />
        </Composer>
      </div>
    </section>
  );
}
