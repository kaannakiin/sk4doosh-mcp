import {
  authSessionResponseSchema,
  type PublicUser,
} from "@chat/contracts/auth/auth";
import type { Locale } from "@chat/contracts/common/locale";
import { queryOptions, useQuery } from "@tanstack/react-query";

import { errorCodeOf, type ChatClient } from "../client.ts";
import { useChatClient } from "../provider.tsx";
import { authKeys } from "./keys.ts";
import { AUTH_PATHS } from "./path.ts";

const CURRENT_USER_STALE_TIME_MS = 5 * 60_000;

/**
 * Guard: being signed out is a state, not a failure. `/auth/me` answers 401 for
 * every visitor without a session, and letting that reach the query as an error
 * would put a failure screen in front of the sign-in page itself.
 */
const ANONYMOUS_CODES = new Set(["unauthorized", "session_expired"]);

/**
 * Loads the signed-in user, or `null` when nobody is signed in.
 */
export function currentUserOptions(client: ChatClient, locale: Locale) {
  return queryOptions({
    queryKey: authKeys.currentUser(),
    staleTime: CURRENT_USER_STALE_TIME_MS,
    /**
     * Guard: the retry policy is inherited, not overridden to `false`. This query
     * gates every route, so a single connection blip during a server render would
     * otherwise take the whole app to its error boundary. The inherited predicate
     * already refuses to retry anything carrying an error envelope.
     */
    queryFn: async ({ signal }): Promise<PublicUser | null> => {
      try {
        const { user } = await client.request(
          AUTH_PATHS.me,
          authSessionResponseSchema,
          { locale, signal },
        );

        return user;
      } catch (error) {
        if (ANONYMOUS_CODES.has(errorCodeOf(error) ?? "")) {
          return null;
        }
        throw error;
      }
    },
  });
}

export function useCurrentUser(locale: Locale) {
  return useQuery(currentUserOptions(useChatClient(), locale));
}
