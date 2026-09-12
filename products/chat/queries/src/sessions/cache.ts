import type { SessionId } from "@chat/contracts/chat/session";
import type { SessionListResponse } from "@chat/contracts/chat/session-page";
import type { SessionSummary } from "@chat/contracts/chat/session-record";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import { chatKeys } from "../keys.ts";

export type SessionListCache = InfiniteData<
  SessionListResponse,
  string | undefined
>;

export type SessionListSnapshot = readonly [
  readonly unknown[],
  SessionListCache | undefined,
][];

function mapPages(
  cache: SessionListCache | undefined,
  map: (sessions: readonly SessionSummary[]) => SessionSummary[],
): SessionListCache | undefined {
  if (cache === undefined) {
    return cache;
  }

  return {
    ...cache,
    pages: cache.pages.map((page) => ({
      ...page,
      sessions: map(page.sessions),
    })),
  };
}

/**
 * Applies a change to every cached page of every session list.
 *
 * @returns the previous contents of each list, for an `onError` rollback
 */
export function patchSessionLists(
  queryClient: QueryClient,
  map: (sessions: readonly SessionSummary[]) => SessionSummary[],
): SessionListSnapshot {
  const snapshot = queryClient.getQueriesData<SessionListCache>({
    queryKey: chatKeys.sessionLists(),
  });

  queryClient.setQueriesData<SessionListCache>(
    { queryKey: chatKeys.sessionLists() },
    (cache) => mapPages(cache, map),
  );

  return snapshot;
}

export function restoreSessionLists(
  queryClient: QueryClient,
  snapshot: SessionListSnapshot,
): void {
  for (const [key, cache] of snapshot) {
    queryClient.setQueryData(key, cache);
  }
}

export function removeSessionFromLists(
  queryClient: QueryClient,
  sessionId: SessionId,
): SessionListSnapshot {
  return patchSessionLists(queryClient, (sessions) =>
    sessions.filter((session) => session.id !== sessionId),
  );
}

export function patchSessionInLists(
  queryClient: QueryClient,
  sessionId: SessionId,
  patch: Partial<SessionSummary>,
): SessionListSnapshot {
  return patchSessionLists(queryClient, (sessions) =>
    sessions.map((session) =>
      session.id === sessionId ? { ...session, ...patch } : session,
    ),
  );
}

/**
 * Moves a session to the head of the list, inserting it when absent.
 *
 * Guard: the api has no create endpoint — a row appears only once a turn has
 * been reconciled — and the list is ordered by `updatedAt` descending, which
 * every completed turn rewrites. So both a brand new conversation and a reply in
 * an old one belong at the front, and neither event is worth a round trip.
 *
 * Guard: the row is removed from every page before it is inserted into the
 * first. Inserting without removing renders the same conversation once per page
 * the visitor has scrolled through.
 */
export function upsertSessionAtFront(
  queryClient: QueryClient,
  session: SessionSummary,
): void {
  queryClient.setQueriesData<SessionListCache>(
    { queryKey: chatKeys.sessionLists() },
    (cache) => {
      if (cache === undefined || cache.pages.length === 0) {
        return cache;
      }

      const pages = cache.pages.map((page) => ({
        ...page,
        sessions: page.sessions.filter((row) => row.id !== session.id),
      }));
      const [first, ...rest] = pages;
      if (first === undefined) {
        return cache;
      }

      return {
        ...cache,
        pages: [{ ...first, sessions: [session, ...first.sessions] }, ...rest],
      };
    },
  );
}
