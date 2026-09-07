import { describe, expect, it } from "vitest";
import {
  assertFresh,
  decodeCursor,
  encodeCursor,
  fingerprint,
  type SheetCursor,
} from "../src/cursor.js";
import type { SkMcpExcelError } from "../src/errors.js";

const stamp = fingerprint("/q1.xlsx", 1, 10);
const otherStamp = fingerprint("/q1.xlsx", 2, 10);

const cursor: SheetCursor = {
  v: 1,
  f: stamp,
  s: "Q1",
  r: 41,
  c: 1,
  e: "T500",
  m: "values",
  g: "master",
  h: 1,
};

function codeOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return (error as SkMcpExcelError).code;
  }
  return "no-error";
}

describe("cursor codec", () => {
  it("round-trips", () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("rejects non base64url payloads", () => {
    expect(codeOf(() => decodeCursor("not-a-cursor"))).toBe("invalid_cursor");
  });

  it("rejects a structurally wrong payload", () => {
    const tampered = Buffer.from(JSON.stringify({ v: 2 }), "utf8").toString(
      "base64url",
    );
    expect(codeOf(() => decodeCursor(tampered))).toBe("invalid_cursor");
  });

  it("rejects a payload with a missing field", () => {
    const rest: Record<string, unknown> = { ...cursor };
    delete rest["h"];
    const partial = Buffer.from(JSON.stringify(rest), "utf8").toString(
      "base64url",
    );
    expect(codeOf(() => decodeCursor(partial))).toBe("invalid_cursor");
  });
});

describe("fingerprint", () => {
  it("changes when the file changes", () => {
    expect(fingerprint("/a.xlsx", 1, 10)).toBe(fingerprint("/a.xlsx", 1, 10));
    expect(fingerprint("/a.xlsx", 2, 10)).not.toBe(
      fingerprint("/a.xlsx", 1, 10),
    );
    expect(fingerprint("/a.xlsx", 1, 11)).not.toBe(
      fingerprint("/a.xlsx", 1, 10),
    );
  });

  it("guards staleness", () => {
    expect(codeOf(() => assertFresh(cursor, stamp))).toBe("no-error");
    expect(codeOf(() => assertFresh(cursor, otherStamp))).toBe("stale_cursor");
  });
});
