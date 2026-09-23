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
 * already started. Releasing the slot on a deadline, or on any timer, would make
 * the gate count work somebody is still waiting for rather than work that is
 * running, and the limit would only be postponed. Work that never settles keeps
 * its slot for the life of the process; restarting the server is the only way
 * to reclaim it, because it is the only thing that ends the work.
 *
 * Attaching a handler here also keeps abandoned work from surfacing as an
 * unhandled rejection after its caller has already been answered.
 */
export function holdUntilSettled(
  work: Promise<unknown>,
  release: () => void,
): void {
  void work.then(release, release);
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
