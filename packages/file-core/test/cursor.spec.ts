import { describe, expect, it } from "vitest";
import {
  decodeCursorPayload,
  encodeCursor,
  fingerprint,
  isFresh,
  type Cursor,
} from "../src/cursor.js";

type IsNever<T> = [T] extends [never] ? true : false;
type Expect<T extends true> = T;

export type ShadowingPositionCollapsesToNever = Expect<
  IsNever<Cursor<{ readonly f: string }>>
>;
export type VersionShadowCollapsesToNever = Expect<
  IsNever<Cursor<{ readonly v: 2 }>>
>;
export type CleanPositionKeepsTheEnvelope = Expect<
  Cursor<{ readonly r: number }> extends { readonly v: 1 } ? true : false
>;

interface Position {
  readonly r: number;
  readonly label: string;
}

const stamp = fingerprint("/a.probe", 1, 10);
const other = fingerprint("/a.probe", 2, 10);

const cursor: Cursor<Position> = { v: 1, f: stamp, r: 7, label: "page" };

describe("the cursor codec", () => {
  it("round-trips the envelope and the position in one flat object", () => {
    const decoded = decodeCursorPayload(encodeCursor(cursor));
    expect(decoded).toEqual({ v: 1, f: stamp, r: 7, label: "page" });
  });

  it("keeps the wire format flat, not nested", () => {
    const raw = Buffer.from(encodeCursor(cursor), "base64url").toString("utf8");
    expect(JSON.parse(raw)).toHaveProperty("r", 7);
    expect(raw).not.toContain("position");
  });

  it("returns undefined for a payload that is not base64url JSON", () => {
    expect(decodeCursorPayload("not-a-cursor")).toBeUndefined();
  });

  it("returns the parsed value even when it is structurally wrong", () => {
    const tampered = Buffer.from(JSON.stringify({ v: 2 }), "utf8").toString(
      "base64url",
    );
    expect(decodeCursorPayload(tampered)).toEqual({ v: 2 });
  });
});

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

describe("isFresh", () => {
  it("holds only for the fingerprint the cursor was issued against", () => {
    expect(isFresh(cursor, stamp)).toBe(true);
    expect(isFresh(cursor, other)).toBe(false);
  });
});
