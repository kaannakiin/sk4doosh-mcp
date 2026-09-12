import { QueryClient } from "@tanstack/react-query";

import { isChatClientError } from "./client.ts";

const DEFAULT_STALE_TIME_MS = 30_000;

const RETRYABLE_ATTEMPTS = 2;

/**
 * Builds the query client both platforms share.
 *
 * Guard: a 4xx is never retried. The api answers 422 for a schema mismatch and
 * 404 for a session the owner does not hold, and repeating either just spends
 * the visitor's battery on an answer that cannot change.
 *
 * @returns a client callers install once per app, or per request when rendering
 *   on a server
 */
export function createChatQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        retry: (failureCount, error) =>
          !isChatClientError(error) && failureCount < RETRYABLE_ATTEMPTS,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
