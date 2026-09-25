import type { SessionId } from "@chat/contracts/chat/session";
import {
  sessionSummarySchema,
  type SessionSummary,
} from "@chat/contracts/chat/session-record";
import type { Locale } from "@chat/contracts/common/locale";
import { useMutation } from "@tanstack/react-query";

import { chatKeys } from "../keys.ts";
import { sessionPath } from "../path.ts";
import { useChatClient } from "../provider.tsx";
import type { SessionView } from "./detail.ts";
import {
  moveSessionPin,
  patchSessionInLists,
  removeSessionFromLists,
  restoreSessionLists,
  touchSession,
  type SessionListCache,
  type SessionListSnapshot,
} from "./cache.ts";

export function useDeleteSession(locale: Locale) {
  const client = useChatClient();

  return useMutation<void, Error, SessionId, SessionListSnapshot>({
    mutationFn: (sessionId) =>
      client.requestNoContent(sessionPath(sessionId), {
        method: "DELETE",
        locale,
      }),
    onMutate: (sessionId, { client: queryClient }) => {
      const snapshot = removeSessionFromLists(queryClient, sessionId);
      queryClient.removeQueries({ queryKey: chatKeys.session(sessionId) });

      return snapshot;
    },
    onError: (_error, _sessionId, snapshot, { client: queryClient }) => {
      if (snapshot !== undefined) {
        restoreSessionLists(queryClient, snapshot);
      }
    },
    onSettled: (
      _data,
      _error,
      _sessionId,
      _onMutateResult,
      { client: queryClient },
    ) => {
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
    onMutate: ({ sessionId, title }, { client: queryClient }) => {
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
    onError: (_error, _input, snapshot, { client: queryClient }) => {
      if (snapshot !== undefined) {
        restoreSessionLists(queryClient, snapshot);
      }
    },
    onSuccess: (session, _input, _onMutateResult, { client: queryClient }) => {
      patchSessionInLists(queryClient, session.id, session);
    },
  });
}

/**
 * Records that the visitor opened a conversation and moves it to the front.
 *
 * Guard: fire and forget, with no rollback. The open is a hint for ordering,
 * and a failed one only leaves the row where the next list fetch puts it.
 */
export function useOpenSession(locale: Locale) {
  const client = useChatClient();

  return useMutation<void, Error, SessionId>({
    mutationFn: (sessionId) =>
      client.requestNoContent(sessionPath(sessionId, "/open"), {
        method: "POST",
        locale,
      }),
    onMutate: (sessionId, { client: queryClient }) => {
      const cached = queryClient
        .getQueriesData<SessionListCache>({
          queryKey: chatKeys.sessionLists(),
        })
        .flatMap(([, cache]) => cache?.pages ?? [])
        .flatMap((page) => [...(page.pinned ?? []), ...page.sessions])
        .find((row) => row.id === sessionId);
      if (cached !== undefined) {
        touchSession(queryClient, {
          ...cached,
          lastOpenedAt: new Date().toISOString(),
        });
      }
    },
  });
}

export interface SetSessionPinnedInput {
  session: SessionSummary;
  pinned: boolean;
}

export function useSetSessionPinned(locale: Locale) {
  const client = useChatClient();

  return useMutation<
    SessionSummary,
    Error,
    SetSessionPinnedInput,
    SessionListSnapshot
  >({
    mutationFn: ({ session, pinned }) =>
      client.request(sessionPath(session.id, "/pin"), sessionSummarySchema, {
        method: pinned ? "PUT" : "DELETE",
        locale,
      }),
    onMutate: ({ session, pinned }, { client: queryClient }) =>
      moveSessionPin(queryClient, {
        ...session,
        pinnedAt: pinned ? new Date().toISOString() : null,
      }),
    onError: (_error, _input, snapshot, { client: queryClient }) => {
      if (snapshot !== undefined) {
        restoreSessionLists(queryClient, snapshot);
      }
    },
    onSuccess: (session, _input, _onMutateResult, { client: queryClient }) => {
      patchSessionInLists(queryClient, session.id, session);
      queryClient.setQueryData<SessionView>(
        chatKeys.session(session.id),
        (view) =>
          view?.session === undefined
            ? view
            : { ...view, session: { ...view.session, ...session } },
      );
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
