/**
 * Guard: identity does not hang off `chatKeys.all`. Signing out sweeps the chat
 * cache with `removeQueries({ queryKey: chatKeys.all })`, and a key nested under
 * it would be swept by the same call that just wrote `null` into it — the guard
 * would then refetch the session it is already navigating away from.
 */
export const authKeys = {
  all: ["auth"] as const,
  currentUser: () => [...authKeys.all, "me"] as const,
} as const;
