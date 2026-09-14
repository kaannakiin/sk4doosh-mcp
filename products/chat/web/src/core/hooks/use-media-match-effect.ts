import { useEffect, useEffectEvent } from "react";

/**
 * Runs `onMatch` on mount and whenever `query` starts matching.
 *
 * Guard: the query is measured in an effect and never read during render, so the
 * first client pass still matches the server's. Returning nothing is what keeps
 * it that way — a caller cannot branch its markup on a value it cannot reach.
 */
export function useMediaMatchEffect(query: string, onMatch: () => void): void {
  const match = useEffectEvent(onMatch);

  useEffect(() => {
    const media = window.matchMedia(query);
    const sync = () => {
      if (media.matches) {
        match();
      }
    };
    sync();
    media.addEventListener("change", sync);

    return () => {
      media.removeEventListener("change", sync);
    };
  }, [query]);
}
