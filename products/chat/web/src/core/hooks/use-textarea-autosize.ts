import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/** Tallest the input grows before it scrolls and offers to expand. */
const COLLAPSED_MAX_PX = 168;

const EXPANDED_MAX_PX = 520;

interface Metrics {
  readonly lineHeight: number;
  readonly padding: number;
}

export interface TextareaAutosize {
  readonly ref: RefObject<HTMLTextAreaElement | null>;
  readonly multiline: boolean;
  readonly overflowing: boolean;
  readonly measure: () => void;
  readonly clear: () => void;
}

function readMetrics(node: HTMLTextAreaElement): Metrics {
  const styles = getComputedStyle(node);
  return {
    lineHeight: Number.parseFloat(styles.lineHeight),
    padding:
      Number.parseFloat(styles.paddingTop) +
      Number.parseFloat(styles.paddingBottom),
  };
}

/**
 * Grows a one-row textarea to fit its value, up to a ceiling that the caller
 * raises by passing `expanded`. The caller drives it by calling `measure` after
 * it changes the value, and empties the box through `clear`.
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
 * moment the webfont replaced the fallback, or the reader zoomed. Those two are
 * also the only events that move it, so it is read once and cached — reading it
 * per keystroke costs a forced style recalc that can never return a new answer.
 */
export function useTextareaAutosize(expanded: boolean): TextareaAutosize {
  const ref = useRef<HTMLTextAreaElement>(null);
  const expandedRef = useRef(expanded);
  const heightRef = useRef(0);
  const metricsRef = useRef<Metrics | null>(null);
  const [multiline, setMultiline] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  const measure = useCallback(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }

    const ceiling = expandedRef.current ? EXPANDED_MAX_PX : COLLAPSED_MAX_PX;

    /**
     * Guard: resetting to `auto` makes the browser lay out the entire value, and
     * that cost is linear in its length. While the box already stands at its
     * ceiling and the content still overruns it, the reset can only ever write
     * the same pixel back, so it is skipped — otherwise every keystroke against
     * a long paste relaid out the whole text twice.
     */
    let content: number;
    if (heightRef.current === ceiling && node.scrollHeight > ceiling) {
      content = node.scrollHeight;
    } else {
      node.style.height = "auto";
      content = node.scrollHeight;
      heightRef.current = Math.min(content, ceiling);
      node.style.height = `${String(heightRef.current)}px`;
    }

    metricsRef.current ??= readMetrics(node);
    const { lineHeight, padding } = metricsRef.current;

    setMultiline(
      Number.isFinite(lineHeight) &&
        lineHeight > 0 &&
        content - padding > lineHeight * 1.5,
    );
    setOverflowing(content > COLLAPSED_MAX_PX);
  }, []);

  const clear = useCallback(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }
    node.value = "";
    measure();
  }, [measure]);

  useLayoutEffect(() => {
    expandedRef.current = expanded;
    measure();
  }, [expanded, measure]);

  useLayoutEffect(() => {
    const refresh = () => {
      metricsRef.current = null;
      measure();
    };

    window.addEventListener("resize", refresh);
    void document.fonts.ready.then(refresh);
    return () => {
      window.removeEventListener("resize", refresh);
    };
  }, [measure]);

  return { ref, multiline, overflowing, measure, clear };
}
