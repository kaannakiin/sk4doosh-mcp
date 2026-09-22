import { describe, expect, it } from "vitest";
import { SingleFlight } from "../src/cache/single-flight.js";

describe("SingleFlight", () => {
  it("F1: coalesces concurrent callers on the same key into one execution", async () => {
    const single = new SingleFlight<string, number>();
    let calls = 0;
    let settle!: (value: number) => void;
    const work = () =>
      new Promise<number>((resolve) => {
        calls++;
        settle = resolve;
      });

    const first = single.run("k", work);
    const second = single.run("k", work);
    expect(calls).toBe(1);

    settle(42);
    await expect(first).resolves.toBe(42);
    await expect(second).resolves.toBe(42);
    expect(calls).toBe(1);
  });

  it("F2: releases the entry once work settles, so the next call runs fresh", async () => {
    const single = new SingleFlight<string, number>();
    let calls = 0;

    await single.run("k", async () => {
      calls++;
      return 1;
    });
    await single.run("k", async () => {
      calls++;
      return 2;
    });

    expect(calls).toBe(2);
  });

  it("F3: propagates rejection to every concurrent waiter", async () => {
    const single = new SingleFlight<string, number>();
    let fail!: (reason: unknown) => void;
    const work = () =>
      new Promise<number>((_resolve, reject) => {
        fail = reject;
      });

    const first = single.run("k", work);
    const second = single.run("k", work);
    const error = new Error("boom");
    fail(error);

    const results = await Promise.allSettled([first, second]);
    expect(results).toEqual([
      { status: "rejected", reason: error },
      { status: "rejected", reason: error },
    ]);
  });

  it("routes a synchronous throw through the same rejection path", async () => {
    const single = new SingleFlight<string, number>();
    const result = single.run("k", () => {
      throw new Error("sync failure");
    });
    await expect(result).rejects.toThrow("sync failure");
  });

  it("keeps unrelated keys independent", async () => {
    const single = new SingleFlight<string, number>();
    let calls = 0;
    const work = async () => {
      calls++;
      return calls;
    };

    const a = await single.run("a", work);
    const b = await single.run("b", work);
    expect(a).toBe(1);
    expect(b).toBe(2);
  });
});
