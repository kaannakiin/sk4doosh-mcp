import { describe, expect, it } from "vitest";
import { classifyContainerMagic } from "../src/index.js";

const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const compound = Uint8Array.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00,
]);

describe("classifyContainerMagic", () => {
  it("names a zip container", () => {
    expect(classifyContainerMagic(zip)).toBe("zip");
  });

  it("names a compound file, which covers both the legacy formats and an encrypted package", () => {
    expect(classifyContainerMagic(compound)).toBe("cfb");
  });

  it("names anything else unknown", () => {
    expect(classifyContainerMagic(new TextEncoder().encode("hello"))).toBe(
      "unknown",
    );
    expect(classifyContainerMagic(new Uint8Array(0))).toBe("unknown");
    expect(classifyContainerMagic(compound.subarray(0, 4))).toBe("unknown");
  });
});
