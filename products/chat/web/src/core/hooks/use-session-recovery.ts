import { authKeys } from "@chat/queries/auth/keys";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useLocale } from "~/core/hooks/use-locale";
import { recoverSession, resetSessionGuard } from "~/lib/auth-refresh";
import { hasSessionHint } from "~/lib/session-hint";

/**
 * Sends a reader whose access token lapsed straight back where they were.
 *
 * Guard: this runs once per mount and is deliberately fire-and-forget. The
 * render decided this visitor was anonymous using the only cookie it can read,
 * and it is wrong exactly when a valid refresh cookie is sitting in the browser —
 * a case that arrives every time someone reloads more than fifteen minutes after
 * their last request.
 */
export function useSessionRecovery(next: string | undefined): void {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current || !hasSessionHint()) {
      return;
    }
    attempted.current = true;

    void recoverSession(locale).then(async (recovered) => {
      if (!recovered) {
        return;
      }
      resetSessionGuard();
      /**
       * Guard: removed, not invalidated. Nothing on the sign-in screen observes
       * the current user, so an invalidation refetches nothing and leaves the
       * `null` the render cached in place — and `ensureQueryData` in the
       * `_authenticated` guard returns cached data whether stale or not, which
       * bounced a freshly recovered reader straight back to this screen.
       */
      queryClient.removeQueries({ queryKey: authKeys.currentUser() });
      await navigate({ to: next ?? "/", replace: true });
    });
  }, [locale, queryClient, navigate, next]);
}
