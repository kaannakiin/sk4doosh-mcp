import { useCallback, useEffect, useRef, useState } from "react";

/** How far from the bottom still counts as "reading the newest turn". */
const STICK_THRESHOLD_PX = 72;

/**
 * Keeps a scroll container pinned to its newest content until the reader scrolls
 * away from it.
 *
 * Guard: the follow write is `scrollTop`, not a smooth `scrollTo`. A stream
 * appends dozens of times a second and a smooth scroll restarts its easing on
 * every one, so the view lags further behind the longer the answer runs.
 *
 * Guard: the listener is passive. A scroll handler that the browser must wait on
 * before compositing turns a stream into visible jank on a phone.
 *
 * @param signal the value that changes whenever new content is appended
 */
export function useStickToBottom(signal: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }

    const onScroll = () => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      const next = distance < STICK_THRESHOLD_PX;
      if (next !== stuck.current) {
        stuck.current = next;
        setPinned(next);
      }
    };

    node.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      node.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (node !== null && stuck.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [signal]);

  const scrollToBottom = useCallback(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    stuck.current = true;
    setPinned(true);
  }, []);

  return { ref, pinned, scrollToBottom };
}
