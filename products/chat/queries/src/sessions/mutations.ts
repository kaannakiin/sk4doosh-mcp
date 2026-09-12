import type { SessionId } from "@chat/contracts/chat/session";
import {
  sessionSummarySchema,
  type SessionSummary,
} from "@chat/contracts/chat/session-record";
import type { Locale } from "@chat/contracts/common/locale";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { chatKeys } from "../keys.ts";
import { sessionPath } from "../path.ts";
import { useChatClient } from "../provider.tsx";
import type { SessionView } from "./detail.ts";
import {
  patchSessionInLists,
  removeSessionFromLists,
  restoreSessionLists,
  type SessionListSnapshot,
} from "./cache.ts";

export function useDeleteSession(locale: Locale) {
  const client = useChatClient();
  const queryClient = useQueryClient();

  return useMutation<void, Error, SessionId, SessionListSnapshot>({
    mutationFn: (sessionId) =>
      client.requestNoContent(sessionPath(sessionId), {
        method: "DELETE",
        locale,
      }),
    onMutate: (sessionId) => {
      const snapshot = removeSessionFromLists(queryClient, sessionId);
      queryClient.removeQueries({ queryKey: chatKeys.session(sessionId) });

      return snapshot;
    },
    onError: (_error, _sessionId, snapshot) => {
      if (snapshot !== undefined) {
        restoreSessionLists(queryClient, snapshot);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.sessionLists() });
    },
  });
}

export interface RenameSessionInput {
  sessionId: SessionId;
  title: string;
}

export function useRenameSession(locale: Locale) {
  const client = useChatClient();
  const queryClient = useQueryClient();

  return useMutation<
    SessionSummary,
    Error,
    RenameSessionInput,
    SessionListSnapshot
  >({
    mutationFn: ({ sessionId, title }) =>
      client.request(sessionPath(sessionId), sessionSummarySchema, {
        method: "PATCH",
        locale,
        body: { title },
      }),
    onMutate: ({ sessionId, title }) => {
      const snapshot = patchSessionInLists(queryClient, sessionId, { title });
      queryClient.setQueryData<SessionView>(
        chatKeys.session(sessionId),
        (view) =>
          view?.session === undefined
            ? view
            : { ...view, session: { ...view.session, title } },
      );

      return snapshot;
    },
    onError: (_error, _input, snapshot) => {
      if (snapshot !== undefined) {
        restoreSessionLists(queryClient, snapshot);
      }
    },
    onSuccess: (session) => {
      patchSessionInLists(queryClient, session.id, session);
    },
  });
}

/**
 * Asks the api to close this session's reader processes and drop its sandbox.
 *
 * Guard: this is not a delete. The conversation and its objects survive; only
 * the process-local materialization is released, and the next turn re-materializes
 * what it needs. Nothing cached is invalidated because nothing the client renders
 * changes.
 */
export function useReleaseSession(locale: Locale) {
  const client = useChatClient();

  return useMutation<void, Error, SessionId>({
    mutationFn: (sessionId) =>
      client.requestNoContent(sessionPath(sessionId, "/release"), {
        method: "POST",
        locale,
      }),
  });
}
