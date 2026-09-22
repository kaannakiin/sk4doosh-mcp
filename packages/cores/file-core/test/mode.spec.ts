import { describe, expect, it } from "vitest";
import { modeFor, type ModePolicy, type SourceMode } from "../src/mode.js";

const policy: ModePolicy = { residentMaxBytes: 8 * 1024 * 1024 };

const rank: Readonly<Record<SourceMode, number>> = { resident: 0, chunked: 1 };

describe("modeFor", () => {
  it("keeps a document at the threshold resident and the next byte chunked", () => {
    expect(modeFor(policy.residentMaxBytes, policy)).toBe("resident");
    expect(modeFor(policy.residentMaxBytes + 1, policy)).toBe("chunked");
  });

  it("is total: no input throws and every answer is a mode", () => {
    const inputs = [
      0,
      -1,
      1,
      Number.NaN,
      Number.EPSILON,
      Number.MAX_SAFE_INTEGER,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ];
    for (const size of inputs) {
      expect(() => modeFor(size, policy)).not.toThrow();
      expect(["resident", "chunked"]).toContain(modeFor(size, policy));
    }
  });

  it("is monotone: a bigger document is never the cheaper tier", () => {
    const sizes = [
      0,
      1,
      1024,
      policy.residentMaxBytes - 1,
      policy.residentMaxBytes,
      policy.residentMaxBytes + 1,
      50 * 1024 * 1024,
      Number.MAX_SAFE_INTEGER,
    ];
    for (let i = 1; i < sizes.length; i += 1) {
      const previous = sizes[i - 1] as number;
      const current = sizes[i] as number;
      expect(rank[modeFor(previous, policy)]).toBeLessThanOrEqual(
        rank[modeFor(current, policy)],
      );
    }
  });

  it("puts every document in the resident tier when the threshold is the ceiling", () => {
    const everything: ModePolicy = { residentMaxBytes: 50 * 1024 * 1024 };
    expect(modeFor(0, everything)).toBe("resident");
    expect(modeFor(50 * 1024 * 1024, everything)).toBe("resident");
  });
});
