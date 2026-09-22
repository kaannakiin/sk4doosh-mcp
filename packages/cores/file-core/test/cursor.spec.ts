import { describe, expect, it } from "vitest";
import { fingerprint } from "../src/cursor.js";

const stamp = fingerprint("/a.probe", 1, 10);

describe("fingerprint", () => {
  it("is stable for the same path, mtime and size", () => {
    expect(fingerprint("/a.probe", 1, 10)).toBe(fingerprint("/a.probe", 1, 10));
  });

  it("changes when the mtime or the size changes", () => {
    expect(fingerprint("/a.probe", 2, 10)).not.toBe(stamp);
    expect(fingerprint("/a.probe", 1, 11)).not.toBe(stamp);
  });

  it("is 16 hex characters", () => {
    expect(stamp).toMatch(/^[0-9a-f]{16}$/);
  });
});
