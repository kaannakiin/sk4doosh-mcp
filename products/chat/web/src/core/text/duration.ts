const SECONDS_PER_MINUTE = 60;

/**
 * Guard: the digits are rendered with `tabular-nums` beside this, so the seconds
 * are always two characters. A countdown that changes width every tick drags the
 * text next to it back and forth.
 */
export function asClock(remainingMs: number): string {
  const total = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(total / SECONDS_PER_MINUTE);
  const seconds = total % SECONDS_PER_MINUTE;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
