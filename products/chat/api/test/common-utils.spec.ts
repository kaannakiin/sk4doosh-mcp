import { describe, expect, it } from "vitest";

import {
  deriveSha256Key,
  sha256Bytes,
} from "../src/common/utils/crypto.utils.ts";
import { errorMessage, errorName } from "../src/common/utils/error.utils.ts";
import {
  isRecord,
  property,
  stringProperty,
} from "../src/common/utils/object.utils.ts";
import { normalizeBoundedString } from "../src/common/utils/string.utils.ts";

describe("common crypto utilities", () => {
  it("hashes deterministically and derives label-separated keys", () => {
    const root = Buffer.alloc(32, 7);

    expect(sha256Bytes("token")).toEqual(sha256Bytes("token"));
    expect(sha256Bytes("token")).not.toEqual(sha256Bytes("other"));
    expect(deriveSha256Key(root, "access")).not.toEqual(
      deriveSha256Key(root, "otp"),
    );
    expect(deriveSha256Key(root, "access", 16)).toHaveLength(16);
  });
});

describe("common error utilities", () => {
  it("normalizes Error and non-Error causes", () => {
    const error = new TypeError("invalid");

    expect(errorMessage(error)).toBe("invalid");
    expect(errorMessage("offline")).toBe("offline");
    expect(errorName(error)).toBe("TypeError");
    expect(errorName("offline")).toBe("UnknownError");
  });
});

describe("common object utilities", () => {
  it("narrows records and reads only matching property types", () => {
    const value: unknown = { name: "Kaan", count: 3 };

    expect(isRecord(value)).toBe(true);
    expect(property(value, "count")).toBe(3);
    expect(stringProperty(value, "name")).toBe("Kaan");
    expect(stringProperty(value, "count")).toBeUndefined();
    expect(property(null, "name")).toBeUndefined();
  });
});

describe("common string utilities", () => {
  it("normalizes bounded non-empty strings", () => {
    expect(
      normalizeBoundedString("  KAAN  ", 20, (value) =>
        value.trim().toLowerCase(),
      ),
    ).toBe("kaan");
    expect(
      normalizeBoundedString("   ", 20, (value) => value.trim()),
    ).toBeUndefined();
    expect(
      normalizeBoundedString("too-long", 3, (value) => value),
    ).toBeUndefined();
  });
});
