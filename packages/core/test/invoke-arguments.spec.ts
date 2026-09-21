import { describe, expect, it } from "vitest";
import {
  compose,
  createRequestTemplate,
  normalizeInvokeArguments,
} from "../src/index.js";

const orderRoute = createRequestTemplate({
  method: "GET",
  route: "/orders/{id}",
  parameters: [{ name: "id", location: "path", kind: "integer" }],
});

describe("normalizeInvokeArguments", () => {
  it("treats null and undefined as no arguments", () => {
    expect(normalizeInvokeArguments(null)).toStrictEqual({
      value: {},
      unwrapped: false,
    });
    expect(normalizeInvokeArguments(undefined)).toStrictEqual({
      value: {},
      unwrapped: false,
    });
  });

  it("leaves an object alone", () => {
    const args = { id: 5 };
    const normalized = normalizeInvokeArguments(args);
    expect(normalized.value).toBe(args);
    expect(normalized.unwrapped).toBe(false);
  });

  it("unwraps JSON text that carries an object and reports the rewrite", () => {
    expect(normalizeInvokeArguments('{"id": 5}')).toStrictEqual({
      value: { id: 5 },
      unwrapped: true,
    });
    expect(normalizeInvokeArguments("{}")).toStrictEqual({
      value: {},
      unwrapped: true,
    });
  });

  it("leaves text that is not a JSON object for the composer to refuse", () => {
    for (const raw of ["id=5", "", "[1]", '"five"', "5"]) {
      const normalized = normalizeInvokeArguments(raw);
      expect(normalized.value).toBe(raw);
      expect(normalized.unwrapped).toBe(false);
    }
  });

  it("composes the unwrapped object", () => {
    const composed = compose(
      orderRoute,
      normalizeInvokeArguments('{"id": 5}').value,
    );
    expect(composed.pathAndQuery).toBe("/orders/5");
  });

  it("names the kind that arrived in the invalid_type message", () => {
    const cases: readonly [unknown, string][] = [
      ["id=5", "a string"],
      [[1], "an array"],
      [5, "a number"],
      [true, "a boolean"],
      [null, "null"],
    ];
    for (const [value, kind] of cases) {
      expect(() => compose(orderRoute, value)).toThrow(
        `Arguments must be a JSON object; received ${kind}.`,
      );
    }
  });
});
