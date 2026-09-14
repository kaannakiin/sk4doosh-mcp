import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Tallest the input grows before it scrolls and offers to expand. */
const COLLAPSED_MAX_PX = 168;

const EXPANDED_MAX_PX = 520;

export interface TextareaAutosize {
  readonly ref: RefObject<HTMLTextAreaElement | null>;
  readonly multiline: boolean;
  readonly overflowing: boolean;
}

/**
 * Grows a one-row textarea to fit its value, up to a ceiling that the caller
 * raises by passing `expanded`.
 *
 * Guard: the height is written straight to the node and only the two derived
 * booleans reach state, so typing re-renders the caller when the shape actually
 * changes — crossing to a second line, or overflowing — rather than on every
 * keystroke. React bails out of a `setState` that lands on the same value, so an
 * ordinary keystroke schedules no render at all.
 *
 * Guard: the line count is derived from the computed line height rather than
 * compared against a pixel constant. A constant sits a pixel or two from the
 * real single-line height, so the box would flip to its tall shape by itself the
 * moment the webfont replaced the fallback, or the reader zoomed.
 *
 * Guard: a layout effect, not `onChange`, because the caller clears the value
 * through state. Measuring in the handler reads the outgoing text and leaves the
 * box tall after the message has gone.
 */
export function useTextareaAutosize(
  value: string,
  expanded: boolean,
): TextareaAutosize {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [multiline, setMultiline] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }

    const ceiling = expanded ? EXPANDED_MAX_PX : COLLAPSED_MAX_PX;
    node.style.height = "auto";
    const content = node.scrollHeight;
    node.style.height = `${String(Math.min(content, ceiling))}px`;

    const styles = getComputedStyle(node);
    const lineHeight = Number.parseFloat(styles.lineHeight);
    const padding =
      Number.parseFloat(styles.paddingTop) +
      Number.parseFloat(styles.paddingBottom);

    setMultiline(
      Number.isFinite(lineHeight) &&
        lineHeight > 0 &&
        content - padding > lineHeight * 1.5,
    );
    setOverflowing(content > COLLAPSED_MAX_PX);
  }, [value, expanded]);

  return { ref, multiline, overflowing };
}
