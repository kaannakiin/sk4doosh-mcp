import { useEffect, useRef, type RefObject } from "react";

export interface InfiniteSentinelOptions {
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly fetchNextPage: () => void;
}

/**
 * Asks for the next page while the returned ref's element is on screen.
 *
 * Guard: the observer is rebuilt whenever paging state changes, because the
 * callback closes over `hasNextPage`. Keeping one observer alive across a page
 * load leaves it asking for a page that no longer exists.
 */
export function useInfiniteSentinel<T extends Element = HTMLDivElement>({
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: InfiniteSentinelOptions): RefObject<T | null> {
  const sentinel = useRef<T>(null);

  useEffect(() => {
    const node = sentinel.current;
    if (node === null || !hasNextPage) {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (
        entries.some((entry) => entry.isIntersecting) &&
        !isFetchingNextPage
      ) {
        fetchNextPage();
      }
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return sentinel;
}
