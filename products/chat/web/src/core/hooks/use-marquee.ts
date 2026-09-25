import { useCallback, useRef, type RefObject } from "react";

const SPEED_PX_PER_SECOND = 40;

const MIN_DURATION_SECONDS = 3;

const EDGE_PX = 12;

export interface Marquee<T extends HTMLElement> {
  readonly ref: RefObject<T | null>;
  readonly start: () => void;
  readonly stop: () => void;
}

/**
 * Scrolls an overflowing single-line label while the pointer or focus is on it.
 * The element carries the `chat-marquee` class; its only child is the text.
 *
 * Guard: the overflow is measured on the frame after `start`, never during
 * render. Hovering a row reveals its action icons, which narrow the label, so a
 * measurement taken in the same frame reads the width the icons are about to
 * take away and stops short of the last word.
 */
export function useMarquee<T extends HTMLElement>(): Marquee<T> {
  const ref = useRef<T>(null);
  const frame = useRef(0);

  const start = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const node = ref.current;
      if (node === null) {
        return;
      }
      const overflow = node.scrollWidth - node.clientWidth;
      if (overflow <= 0) {
        return;
      }
      const shift = overflow + EDGE_PX;
      node.style.setProperty("--marquee-shift", `${String(shift)}px`);
      node.style.setProperty(
        "--marquee-duration",
        `${String(Math.max(MIN_DURATION_SECONDS, shift / SPEED_PX_PER_SECOND))}s`,
      );
      node.dataset.marquee = "";
    });
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    const node = ref.current;
    if (node !== null) {
      delete node.dataset.marquee;
    }
  }, []);

  return { ref, start, stop };
}
