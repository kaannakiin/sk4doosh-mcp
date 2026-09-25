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

type SessionMap = (sessions: readonly SessionSummary[]) => SessionSummary[];

function mapPages(cache: SessionListCache, map: SessionMap): SessionListCache {
  return {
    ...cache,
    pages: cache.pages.map((page) => ({
      ...page,
      ...(page.pinned === undefined ? {} : { pinned: map(page.pinned) }),
      sessions: map(page.sessions),
    })),
  };
}

function withoutSession(
  cache: SessionListCache,
  sessionId: SessionId,
): SessionListCache["pages"] {
  const drop: SessionMap = (sessions) =>
    sessions.filter((row) => row.id !== sessionId);

  return cache.pages.map((page) => ({
    ...page,
    ...(page.pinned === undefined ? {} : { pinned: drop(page.pinned) }),
    sessions: drop(page.sessions),
  }));
}

function findCached(
  cache: SessionListCache,
  sessionId: SessionId,
): SessionSummary | undefined {
  for (const page of cache.pages) {
    const found = [...(page.pinned ?? []), ...page.sessions].find(
      (row) => row.id === sessionId,
    );
    if (found !== undefined) {
      return found;
    }
  }

  return undefined;
}

function updateLists(
  queryClient: QueryClient,
  update: (cache: SessionListCache) => SessionListCache,
): SessionListSnapshot {
  const snapshot = queryClient.getQueriesData<SessionListCache>({
    queryKey: chatKeys.sessionLists(),
  });

  queryClient.setQueriesData<SessionListCache>(
    { queryKey: chatKeys.sessionLists() },
    (cache) =>
      cache === undefined || cache.pages.length === 0 ? cache : update(cache),
  );

  return snapshot;
}

/**
 * Applies a change to every cached page of every session list, pinned rows
 * included.
 *
 * @returns the previous contents of each list, for an `onError` rollback
 */
export function patchSessionLists(
  queryClient: QueryClient,
  map: SessionMap,
): SessionListSnapshot {
  const snapshot = queryClient.getQueriesData<SessionListCache>({
    queryKey: chatKeys.sessionLists(),
  });

  queryClient.setQueriesData<SessionListCache>(
    { queryKey: chatKeys.sessionLists() },
    (cache) => (cache === undefined ? cache : mapPages(cache, map)),
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
 * Records activity on a session: an open, a submitted turn or a finished one.
 *
 * Guard: the api has no create endpoint — a row appears only once a turn has
 * been reconciled — and recents are ordered by `lastOpenedAt` descending, which
 * every open and every turn rewrites. So a brand new conversation, a reply in an
 * old one and a click on a row all belong at the front, and none of them is
 * worth a round trip.
 *
 * Guard: a pinned row is patched where it stands and its pin is read from the
 * cache, not from `session`. Callers hold summaries from the detail view, which
 * a pin made from the sidebar does not rewrite, so trusting theirs would drop a
 * pinned conversation back into recents on its next turn.
 *
 * Guard: the row is removed from every page before it is inserted into the
 * first. Inserting without removing renders the same conversation once per page
 * the visitor has scrolled through.
 */
export function touchSession(
  queryClient: QueryClient,
  session: SessionSummary,
): void {
  updateLists(queryClient, (cache) => {
    const cached = findCached(cache, session.id);
    const merged: SessionSummary = {
      ...cached,
      ...session,
      pinnedAt: cached === undefined ? session.pinnedAt : cached.pinnedAt,
    };

    if (merged.pinnedAt !== null && cached !== undefined) {
      return mapPages(cache, (sessions) =>
        sessions.map((row) => (row.id === merged.id ? merged : row)),
      );
    }

    const [first, ...rest] = withoutSession(cache, session.id);
    if (first === undefined) {
      return cache;
    }

    return {
      ...cache,
      pages: [{ ...first, sessions: [merged, ...first.sessions] }, ...rest],
    };
  });
}

/**
 * Moves a session between the pinned list and recents.
 *
 * Guard: an unpinned row goes back to its `lastOpenedAt` position, and is
 * dropped instead when that position lies past the last loaded row while more
 * pages exist. Appending it there would put it above rows the next page is
 * about to deliver, and the next page will deliver it anyway.
 *
 * @returns the previous contents of each list, for an `onError` rollback
 */
export function moveSessionPin(
  queryClient: QueryClient,
  session: SessionSummary,
): SessionListSnapshot {
  return updateLists(queryClient, (cache) => {
    const [first, ...rest] = withoutSession(cache, session.id);
    if (first === undefined) {
      return cache;
    }

    if (session.pinnedAt !== null) {
      return {
        ...cache,
        pages: [
          { ...first, pinned: [session, ...(first.pinned ?? [])] },
          ...rest,
        ],
      };
    }

    const pages = [first, ...rest];
    const last = pages.at(-1);
    const more = last?.nextCursor !== undefined;
    const target = pages.findIndex((page) =>
      page.sessions.some((row) => row.lastOpenedAt < session.lastOpenedAt),
    );
    if (target === -1 && more) {
      return { ...cache, pages };
    }

    const index = target === -1 ? pages.length - 1 : target;

    return {
      ...cache,
      pages: pages.map((page, position) => {
        if (position !== index) {
          return page;
        }
        const at = page.sessions.findIndex(
          (row) => row.lastOpenedAt < session.lastOpenedAt,
        );
        const sessions = [...page.sessions];
        sessions.splice(at === -1 ? sessions.length : at, 0, session);

        return { ...page, sessions };
      }),
    };
  });
}
