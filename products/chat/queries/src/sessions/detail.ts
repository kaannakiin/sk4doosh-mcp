import type { Attachment } from "@chat/contracts/attachment/attachment";
import type { StoredMessage } from "@chat/contracts/chat/message";
import type { SessionId } from "@chat/contracts/chat/session";
import { sessionDetailResponseSchema } from "@chat/contracts/chat/session-detail";
import type { SessionSummary } from "@chat/contracts/chat/session-record";
import type { Locale } from "@chat/contracts/common/locale";
import { queryOptions, useQuery } from "@tanstack/react-query";

import { isSessionNotFound, type ChatClient } from "../client.ts";
import { chatKeys } from "../keys.ts";
import { sessionPath } from "../path.ts";
import { useChatClient } from "../provider.tsx";

const DETAIL_STALE_TIME_MS = 5 * 60_000;

/**
 * A conversation as the client renders it.
 *
 * `fresh` says the api has never heard of this id, which is the normal state of
 * a session the browser minted but has not yet completed a turn in.
 */
export interface SessionView {
  readonly session: SessionSummary | undefined;
  readonly messages: readonly StoredMessage[];
  readonly attachments: readonly Attachment[];
  readonly truncated: boolean;
  readonly fresh: boolean;
}

const EMPTY_SESSION: SessionView = {
  session: undefined,
  messages: [],
  attachments: [],
  truncated: false,
  fresh: true,
};

/**
 * Loads one conversation, treating "not found" as an empty one.
 *
 * Guard: the api answers 404 both for a session that has not been persisted yet
 * and for one belonging to another owner — it refuses to distinguish them, so a
 * stranger cannot confirm an id exists. Neither case is an error the visitor can
 * act on; both open an empty conversation. Rethrowing here would put a failure
 * screen in front of every brand new chat.
 */
export function sessionDetailOptions(
  client: ChatClient,
  sessionId: SessionId,
  locale: Locale,
) {
  return queryOptions({
    queryKey: chatKeys.session(sessionId),
    staleTime: DETAIL_STALE_TIME_MS,
    retry: false,
    queryFn: async ({ signal }): Promise<SessionView> => {
      try {
        const detail = await client.request(
          sessionPath(sessionId),
          sessionDetailResponseSchema,
          { locale, signal },
        );

        return { ...detail, fresh: false };
      } catch (error) {
        if (isSessionNotFound(error)) {
          return EMPTY_SESSION;
        }
        throw error;
      }
    },
  });
}

export function useSessionDetail(sessionId: SessionId, locale: Locale) {
  return useQuery(sessionDetailOptions(useChatClient(), sessionId, locale));
}
