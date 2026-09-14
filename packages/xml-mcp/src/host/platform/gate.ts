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
