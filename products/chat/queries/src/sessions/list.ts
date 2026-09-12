import { SESSION_PAGE_SIZE_DEFAULT } from "@chat/contracts/chat/session-limits";
import {
  sessionListResponseSchema,
  type SessionListResponse,
} from "@chat/contracts/chat/session-page";
import type { SessionSummary } from "@chat/contracts/chat/session-record";
import type { Locale } from "@chat/contracts/common/locale";
import { infiniteQueryOptions, useInfiniteQuery } from "@tanstack/react-query";

import type { ChatClient } from "../client.ts";
import { chatKeys } from "../keys.ts";
import { withQuery } from "../path.ts";
import { useChatClient } from "../provider.tsx";

export interface SessionListParams {
  locale: Locale;
  limit?: number;
}

/**
 * The owner's sessions, newest first, paged by the api's keyset cursor.
 *
 * Guard: the locale is not part of the query key. It reaches the api only so a
 * failure comes back in the visitor's language; every field in the response is
 * either an identifier or text the visitor typed. Keying on it would throw the
 * whole list away on a language switch.
 *
 * `select` flattens the pages, so subscribers re-render on a changed session
 * rather than on a changed page envelope.
 */
export function sessionListOptions(
  client: ChatClient,
  { locale, limit = SESSION_PAGE_SIZE_DEFAULT }: SessionListParams,
) {
  return infiniteQueryOptions({
    queryKey: chatKeys.sessionList(limit),
    queryFn: ({ pageParam, signal }) =>
      client.request(
        withQuery("/chat/sessions", { cursor: pageParam, limit }),
        sessionListResponseSchema,
        { locale, signal },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: SessionListResponse) => page.nextCursor,
    select: (data): readonly SessionSummary[] =>
      data.pages.flatMap((page) => page.sessions),
  });
}

export function useSessionList(params: SessionListParams) {
  return useInfiniteQuery(sessionListOptions(useChatClient(), params));
}
