import { useEffect, useState } from "react";

/**
 * Counts down to an instant, re-rendering at a chosen granularity.
 *
 * Guard: the tick interval is a parameter because the two countdowns on the
 * verification screen have opposite needs. The resend button is a per-second
 * affordance; the ten minute expiry line refreshed every second would be a
 * per-second re-render of the whole screen for a number nobody watches.
 *
 * @returns milliseconds remaining, never negative
 */
export function useCountdown(target: number, tickMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (target <= Date.now()) {
      return;
    }
    const timer = setInterval(() => {
      setNow(Date.now());
    }, tickMs);

    return () => {
      clearInterval(timer);
    };
  }, [target, tickMs]);

  return Math.max(0, target - now);
}
