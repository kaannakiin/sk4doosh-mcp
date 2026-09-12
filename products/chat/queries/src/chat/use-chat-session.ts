import type { StoredMessage } from "@chat/contracts/chat/message";
import type { SessionId } from "@chat/contracts/chat/session";
import type { SessionSummary } from "@chat/contracts/chat/session-record";
import type { Locale } from "@chat/contracts/common/locale";
import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import { useEffect, useMemo, useRef } from "react";

import { chatKeys } from "../keys.ts";
import { useChatClient } from "../provider.tsx";
import { upsertSessionAtFront } from "../sessions/cache.ts";
import { createChatTransport } from "./transport.ts";

/**
 * Guard: the ui batches stream updates instead of rendering every token. A
 * reader answer arrives as hundreds of deltas, and without this each one is a
 * render of the whole log.
 */
const STREAM_THROTTLE_MS = 50;

export interface ChatSessionParams {
  sessionId: SessionId;
  locale: Locale;
  /** The persisted history, read once when the chat is created. */
  initialMessages: readonly StoredMessage[];
  /** The persisted row, absent until this session has completed a turn. */
  session: SessionSummary | undefined;
  attachmentCount: number;
}

/**
 * Drives one conversation: the AI SDK stream, plus the cache writes that keep
 * the session list honest while it runs.
 *
 * Guard: the caller must have loaded the history before rendering the component
 * that calls this, and must key that component on `sessionId`. `useChat` reads
 * `messages` only when it builds its store — which it does once per `id` — so a
 * history that arrives on a later render is silently ignored, and switching
 * conversations without a remount leaves the previous one's turns on screen.
 */
export function useChatSession({
  sessionId,
  locale,
  initialMessages,
  session,
  attachmentCount,
}: ChatSessionParams) {
  const client = useChatClient();
  const queryClient = useQueryClient();

  const transport = useMemo(
    () => createChatTransport(client, { sessionId, locale }),
    [client, sessionId, locale],
  );

  const listed = useRef(session !== undefined);
  const awaitingTitle = useRef(session?.title == null);

  const base = useMemo<SessionSummary>(
    () =>
      session ?? {
        id: sessionId,
        title: null,
        messageCount: initialMessages.length,
        attachmentCount,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    [session, sessionId, initialMessages.length, attachmentCount],
  );

  /**
   * Guard: the stored parts cross into the SDK's union unchecked. The api
   * validated them with `validateUIMessages` on the way out of the database, and
   * re-declaring that union in `@chat/contracts` would fork a copy of the SDK's
   * stream contract that drifts on every upgrade.
   */
  const chat = useChat({
    id: sessionId,
    messages: initialMessages as unknown as UIMessage[],
    transport,
    throttle: STREAM_THROTTLE_MS,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: ({ messages }) => {
      upsertSessionAtFront(queryClient, {
        ...base,
        messageCount: messages.length,
        updatedAt: new Date().toISOString(),
      });
      void queryClient.invalidateQueries({
        queryKey: chatKeys.session(sessionId),
        refetchType: "none",
      });

      /**
       * Guard: the title is the api's to write — the first turn's reconcile sets
       * it with `coalesce(title, …)` — so the one turn that mints it is also the
       * only one worth a real refetch. Deriving it a second time here would fork
       * `titleFrom` and drift from it; refetching on every turn would re-read
       * every page the visitor has scrolled through to learn an ordering this
       * already applied.
       */
      const refetchType = awaitingTitle.current ? "active" : "none";
      awaitingTitle.current = false;
      void queryClient.invalidateQueries({
        queryKey: chatKeys.sessionLists(),
        refetchType,
      });
    },
  });

  const { status } = chat;

  /**
   * Guard: the row is published the moment the request is submitted, not when it
   * finishes. The api creates the row lazily while reconciling the first turn, so
   * without this the visitor's new conversation is missing from the sidebar for
   * the whole of its first answer.
   */
  useEffect(() => {
    if (status !== "submitted" || listed.current) {
      return;
    }
    listed.current = true;
    upsertSessionAtFront(queryClient, base);
  }, [status, queryClient, base]);

  return chat;
}
