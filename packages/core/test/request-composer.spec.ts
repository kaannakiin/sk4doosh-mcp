import { describe, expect, it } from "vitest";
import {
  compose,
  createRequestTemplate,
  SkMcpArgumentError,
  type RequestTemplate,
  type SkMcpArgumentErrorCode,
} from "../src/index.js";

function expectError(
  fn: () => unknown,
  code: SkMcpArgumentErrorCode,
): SkMcpArgumentError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(SkMcpArgumentError);
    expect((error as SkMcpArgumentError).code).toBe(code);
    return error as SkMcpArgumentError;
  }
  return expect.unreachable(`expected ${code}`);
}

const orderRoute: RequestTemplate = createRequestTemplate({
  method: "GET",
  route: "/orders/{id}",
  parameters: [{ name: "id", location: "path", kind: "integer" }],
});

describe("compose", () => {
  it("rejects non-object arguments", () => {
    expectError(() => compose(orderRoute, [1]), "invalid_type");
    expectError(() => compose(orderRoute, "id=5"), "invalid_type");
  });

  it("rejects a wrong-typed path value before dispatch", () => {
    expectError(() => compose(orderRoute, { id: "abc" }), "invalid_path_type");
  });

  it("requires every path parameter", () => {
    expectError(() => compose(orderRoute, {}), "missing_path_parameter");
    expectError(
      () => compose(orderRoute, { id: null }),
      "missing_path_parameter",
    );
  });

  it("lists allowed names on unknown arguments", () => {
    const error = expectError(
      () => compose(orderRoute, { id: 5, idd: 6 }),
      "unknown_argument",
    );
    expect(error.message).toContain("idd");
    expect(error.message).toContain("Allowed: id");
  });

  it("keeps a query value with separators as one parameter", () => {
    const template = createRequestTemplate({
      method: "GET",
      route: "/items",
      parameters: [{ name: "q", location: "query", kind: "string" }],
    });
    expect(compose(template, { q: "a&admin=true" }).pathAndQuery).toBe(
      "/items?q=a%26admin%3Dtrue",
    );
  });

  it("rejects header values with control characters", () => {
    const template = createRequestTemplate({
      method: "GET",
      route: "/items",
      parameters: [{ name: "X-Data", location: "header", kind: "string" }],
    });
    expectError(
      () => compose(template, { "X-Data": "a\r\nInjected: x" }),
      "header_injection",
    );
    expect(compose(template, { "X-Data": "clean" }).headers).toEqual({
      "X-Data": "clean",
    });
  });

  it("rejects a scalar for an array parameter", () => {
    const template = createRequestTemplate({
      method: "GET",
      route: "/items",
      parameters: [
        { name: "tag", location: "query", kind: "string", isArray: true },
      ],
    });
    expectError(() => compose(template, { tag: "a" }), "invalid_type");
  });

  it("gates integers to the safe range and accepts whole doubles", () => {
    expect(compose(orderRoute, { id: 9007199254740991 }).pathAndQuery).toBe(
      "/orders/9007199254740991",
    );
    expect(compose(orderRoute, { id: JSON.parse("1.0") }).pathAndQuery).toBe(
      "/orders/1",
    );
    expectError(
      () => compose(orderRoute, { id: 9007199254740992 }),
      "invalid_path_type",
    );
    expectError(() => compose(orderRoute, { id: 1.5 }), "invalid_path_type");
  });

  it("serializes numbers in canonical shortest form", () => {
    const template = createRequestTemplate({
      method: "GET",
      route: "/products",
      parameters: [{ name: "price", location: "query", kind: "number" }],
    });
    expect(compose(template, { price: JSON.parse("1.50") }).pathAndQuery).toBe(
      "/products?price=1.5",
    );
  });

  it("flattens only unbound declared fields into the body", () => {
    const template = createRequestTemplate({
      method: "POST",
      route: "/orders/{id}/notes",
      parameters: [
        { name: "id", location: "path", kind: "integer" },
        { name: "notify", location: "query", kind: "boolean" },
      ],
      bodyProperties: ["text"],
    });
    const composed = compose(template, { id: 5, notify: true, text: "hello" });
    expect(composed.pathAndQuery).toBe("/orders/5/notes?notify=true");
    expect(composed.bodyJson).toEqual({ text: "hello" });
  });

  it("collects undeclared fields when additional properties are allowed", () => {
    const template = createRequestTemplate({
      method: "POST",
      route: "/orders",
      bodyAllowsAdditionalProperties: true,
    });
    expect(compose(template, { anything: 1 }).bodyJson).toEqual({
      anything: 1,
    });
  });

  it("treats undefined values as absent", () => {
    const template = createRequestTemplate({
      method: "GET",
      route: "/items",
      parameters: [{ name: "q", location: "query", kind: "string" }],
    });
    expect(compose(template, { q: undefined }).pathAndQuery).toBe("/items");
  });

  it("produces an empty body object when a body is declared but no fields sent", () => {
    const template = createRequestTemplate({
      method: "POST",
      route: "/orders",
      bodyProperties: ["text"],
    });
    expect(compose(template, {}).bodyJson).toEqual({});
  });
});
