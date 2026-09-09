import { describe, expect, it } from "vitest";
import {
  addTo,
  newSum,
  NumericPrecisionError,
  sumOf,
  toNumber,
} from "../src/numeric.js";

const accepted: readonly (readonly [string, number, boolean])[] = [
  ["1", 1, false],
  ["10.50", 10.5, false],
  ["10.10", 10.1, true],
  ["0.1", 0.1, true],
  ["0.125", 0.125, false],
  ["-3.75", -3.75, false],
  ["1.", 1, false],
  [".5", 0.5, false],
  ["10.00", 10, false],
  ["9007199254740992", 9007199254740992, false],
  ["  42  ", 42, false],
];

const rejected: readonly string[] = [
  "1e400",
  "1E4",
  "+1",
  "abc",
  "",
  ".",
  "-",
  "1,5",
  "0x10",
  "Infinity",
  "NaN",
];

const tooManyDigits: readonly string[] = [
  "1234567890123456789",
  "9007199254740993",
  "1234567890123456789.5",
  "00012345678901234567890",
];

describe("the numeric lexical policy", () => {
  it("accepts the XPath 1.0 number forms and says which lost exactness", () => {
    for (const [text, value, rounded] of accepted) {
      const parsed = toNumber(text);
      expect(parsed, text).toBeDefined();
      expect(parsed?.value, text).toBe(value);
      expect(parsed?.rounded, text).toBe(rounded);
    }
  });

  it("treats anything outside those forms as not a number, exponents included", () => {
    for (const text of rejected) {
      expect(toNumber(text), text).toBeUndefined();
    }
  });

  it("refuses loudly when the digits outrun the mantissa", () => {
    for (const text of tooManyDigits) {
      expect(() => toNumber(text), text).toThrow(NumericPrecisionError);
    }
  });

  it("keeps negative zero apart from zero", () => {
    expect(Object.is(toNumber("-0")?.value, -0)).toBe(true);
    expect(Object.is(toNumber("0")?.value, -0)).toBe(false);
  });

  it("trims only XML whitespace", () => {
    expect(toNumber("\u000a7\u0009")?.value).toBe(7);
    expect(toNumber(" 7 ")?.value).toBe(7);
    expect(toNumber("\u00a07")).toBeUndefined();
  });
});

describe("compensated summation", () => {
  it("keeps a small addend that plain addition would drop", () => {
    const state = newSum();
    addTo(state, 1e16);
    for (let round = 0; round < 10; round += 1) addTo(state, 1);
    expect(sumOf(state)).toBe(10000000000000010);
  });

  it("adds nothing to an empty sum", () => {
    expect(sumOf(newSum())).toBe(0);
  });
});
