import { describe, expect, it } from "vitest";
import { detectByteOrderMark } from "../src/bom.js";

const bytes = (...values: number[]) => Uint8Array.from(values);

describe("detectByteOrderMark", () => {
  it("recognises every mark with its length", () => {
    expect(detectByteOrderMark(bytes(0xef, 0xbb, 0xbf, 0x41))).toEqual({
      encoding: "utf-8",
      length: 3,
    });
    expect(detectByteOrderMark(bytes(0xff, 0xfe, 0x41, 0x00))).toEqual({
      encoding: "utf-16le",
      length: 2,
    });
    expect(detectByteOrderMark(bytes(0xfe, 0xff, 0x00, 0x41))).toEqual({
      encoding: "utf-16be",
      length: 2,
    });
  });

  it("prefers the four byte forms over their two byte prefixes", () => {
    expect(detectByteOrderMark(bytes(0xff, 0xfe, 0x00, 0x00))).toEqual({
      encoding: "utf-32le",
      length: 4,
    });
    expect(detectByteOrderMark(bytes(0x00, 0x00, 0xfe, 0xff))).toEqual({
      encoding: "utf-32be",
      length: 4,
    });
  });

  it("reads a bare utf-16le mark when nothing follows it", () => {
    expect(detectByteOrderMark(bytes(0xff, 0xfe))).toEqual({
      encoding: "utf-16le",
      length: 2,
    });
  });

  it("does not guess from a truncated mark", () => {
    expect(detectByteOrderMark(bytes(0xff))).toBeUndefined();
    expect(detectByteOrderMark(bytes(0xef, 0xbb))).toBeUndefined();
  });

  it("returns undefined rather than guessing an encoding", () => {
    expect(detectByteOrderMark(bytes(0x3c, 0x3f, 0x78, 0x6d))).toBeUndefined();
    expect(detectByteOrderMark(bytes())).toBeUndefined();
    expect(detectByteOrderMark(bytes(0x00, 0x00, 0x00, 0x00))).toBeUndefined();
  });
});
