import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGate, holdUntilSettled } from "../src/platform/gate.js";

function refuse(): never {
  throw new Error("refused");
}

describe("a slot held by unfinished work", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * The failure this guards: a timer that hands the slot back while the work is
   * still running only postpones the limit, and the gate then counts less work
   * than is actually in flight.
   */
  it("is never reclaimed by the passage of time", async () => {
    const gate = createGate(1, refuse);
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    holdUntilSettled(work, gate.enter());

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(gate.active).toBe(1);
    expect(() => gate.enter()).toThrow("refused");

    finish();
    await vi.runAllTimersAsync();
    expect(gate.active).toBe(0);
  });

  it("is returned when the work fails", async () => {
    const gate = createGate(1, refuse);
    let fail!: (error: Error) => void;
    const work = new Promise<void>((_resolve, reject) => {
      fail = reject;
    });
    holdUntilSettled(work, gate.enter());

    fail(new Error("engine crashed"));
    await vi.runAllTimersAsync();
    expect(gate.active).toBe(0);
  });
});
