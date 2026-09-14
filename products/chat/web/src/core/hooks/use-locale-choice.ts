import type { Locale } from "@chat/contracts/common/locale";
import { useRouter } from "@tanstack/react-router";
import { useCallback } from "react";

import { rememberLocale } from "~/lib/locale-cookie";

/**
 * Records the reader's language choice.
 *
 * Guard: the choice is written to the cookie and the router is invalidated, not
 * navigated. The locale is no longer a path segment, so there is no url to move
 * to — invalidating re-runs the root `beforeLoad`, which reads the cookie back
 * and rebuilds the i18next instance without discarding the conversation on
 * screen or the query cache behind it.
 */
export function useLocaleChoice(): (locale: Locale) => void {
  const router = useRouter();

  return useCallback(
    (locale: Locale) => {
      rememberLocale(locale);
      void router.invalidate();
    },
    [router],
  );
}
