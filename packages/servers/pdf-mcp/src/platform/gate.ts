export interface Gate {
  enter(): () => void;
  readonly active: number;
}

export function createGate(limit: number, refuse: () => never): Gate {
  let active = 0;
  return {
    get active() {
      return active;
    },
    enter() {
      if (active >= limit) refuse();
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
  };
}

/**
 * Holds a gate slot until the work itself settles, not until the caller stops
 * waiting for it.
 *
 * Guard: neither the PDF engine's async task nor an injected OCR port is
 * cancellable by contract — Node-API cannot cancel an async work item that has
 * already started. Releasing the slot when a deadline answers the caller would
 * make the gate count requests that have not timed out rather than work that is
 * running, and a host could be asked to run any number of transcriptions at
 * once. The quarantine is the bounded escape hatch: work that never settles
 * would otherwise cost that slot forever, so past it the slot is reclaimed and
 * the overshoot is bounded instead of permanent.
 *
 * Attaching a handler here also keeps abandoned work from surfacing as an
 * unhandled rejection after its caller has already been answered.
 */
export function holdUntilSettled(
  work: Promise<unknown>,
  release: () => void,
  quarantineMs: number,
): void {
  let released = false;
  const free = (): void => {
    if (released) return;
    released = true;
    release();
  };
  const quarantine = setTimeout(free, quarantineMs);
  quarantine.unref();
  void work.then(free, free).then(() => {
    clearTimeout(quarantine);
  });
}

export interface Deadline {
  readonly signal: AbortSignal;
  run<T>(work: Promise<T>): Promise<T>;
}

/**
 * Bounds how long a caller waits, and asks the work to stop.
 *
 * Guard: a port that honours the signal can stop early, but nothing here can
 * force it to. The deadline decides when to answer, never when the work ends —
 * `holdUntilSettled` is what keeps the resource accounted for until it does.
 */
export function createDeadline(
  timeoutMs: number,
  onExpiry: () => Error,
): Deadline {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(onExpiry());
    }, timeoutMs);
    timer.unref();
  });
  return {
    signal: controller.signal,
    async run<T>(work: Promise<T>): Promise<T> {
      try {
        return await Promise.race([work, expiry]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
