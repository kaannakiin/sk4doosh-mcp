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

function arrayQuery(separator?: string): RequestTemplate {
  return createRequestTemplate({
    method: "GET",
    route: "/items",
    parameters: [
      {
        name: "tag",
        location: "query",
        kind: "string",
        isArray: true,
        ...(separator === undefined ? {} : { arraySeparator: separator }),
      },
    ],
  });
}

describe("compose array styles", () => {
  it("repeats the key when no separator is declared", () => {
    expect(compose(arrayQuery(), { tag: ["a", "b"] }).pathAndQuery).toBe(
      "/items?tag=a&tag=b",
    );
  });

  it("joins on the declared separator", () => {
    expect(compose(arrayQuery(","), { tag: ["a", "b"] }).pathAndQuery).toBe(
      "/items?tag=a,b",
    );
    expect(compose(arrayQuery("|"), { tag: ["a", "b"] }).pathAndQuery).toBe(
      "/items?tag=a|b",
    );
    expect(compose(arrayQuery(" "), { tag: ["a", "b"] }).pathAndQuery).toBe(
      "/items?tag=a%20b",
    );
  });

  it("encodes an item that contains the separator", () => {
    expect(compose(arrayQuery(","), { tag: ["a,b", "c"] }).pathAndQuery).toBe(
      "/items?tag=a%2Cb,c",
    );
  });

  it("writes no key for an empty array in every style", () => {
    expect(compose(arrayQuery(), { tag: [] }).pathAndQuery).toBe("/items");
    expect(compose(arrayQuery(","), { tag: [] }).pathAndQuery).toBe("/items");
  });

  it("folds a header array onto one value", () => {
    const template = createRequestTemplate({
      method: "GET",
      route: "/items",
      parameters: [
        {
          name: "x-tag",
          location: "header",
          kind: "string",
          isArray: true,
          arraySeparator: ",",
        },
      ],
    });
    expect(compose(template, { "x-tag": ["a", "b"] }).headers).toEqual({
      "x-tag": "a,b",
    });
    expectError(() => compose(template, { "x-tag": "a" }), "invalid_type");
  });

  it("rejects a control character smuggled through a header array item", () => {
    const template = createRequestTemplate({
      method: "GET",
      route: "/items",
      parameters: [
        {
          name: "x-tag",
          location: "header",
          kind: "string",
          isArray: true,
          arraySeparator: ",",
        },
      ],
    });
    expectError(
      () => compose(template, { "x-tag": ["a", "b\r\nx: y"] }),
      "header_injection",
    );
  });
});

describe("object-valued query parameters", () => {
  const filterTemplate = (
    notation: "bracket" | "dot",
    extra: Record<string, unknown> = {},
  ): RequestTemplate =>
    createRequestTemplate({
      method: "GET",
      route: "/items",
      parameters: [
        {
          name: "filter",
          location: "query",
          kind: "object",
          notation,
          members: [
            { name: "status", kind: "string" },
            { name: "min", kind: "integer" },
            { name: "tags", kind: "string", isArray: true },
          ],
          ...extra,
        },
      ],
    });

  it("writes bracket notation, one key per supplied member", () => {
    expect(
      compose(filterTemplate("bracket"), {
        filter: { status: "active", min: 3 },
      }).pathAndQuery,
    ).toBe("/items?filter[status]=active&filter[min]=3");
  });

  it("writes dot notation from the same template shape", () => {
    expect(
      compose(filterTemplate("dot"), { filter: { status: "active", min: 3 } })
        .pathAndQuery,
    ).toBe("/items?filter.status=active&filter.min=3");
  });

  it("writes members in declaration order, not the order the agent sent them", () => {
    expect(
      compose(filterTemplate("bracket"), { filter: { min: 3, status: "a" } })
        .pathAndQuery,
    ).toBe("/items?filter[status]=a&filter[min]=3");
  });

  it("repeats the whole key for an array member and omits an empty one", () => {
    expect(
      compose(filterTemplate("dot"), { filter: { tags: ["a", "b"] } })
        .pathAndQuery,
    ).toBe("/items?filter.tags=a&filter.tags=b");
    expect(
      compose(filterTemplate("dot"), { filter: { tags: [] } }).pathAndQuery,
    ).toBe("/items");
  });

  it("writes no key at all for an empty or absent object", () => {
    expect(
      compose(filterTemplate("bracket"), { filter: {} }).pathAndQuery,
    ).toBe("/items");
    expect(compose(filterTemplate("bracket"), {}).pathAndQuery).toBe("/items");
  });

  it("encodes the member value but never the structural character", () => {
    expect(
      compose(filterTemplate("bracket"), { filter: { status: "a[b] c" } })
        .pathAndQuery,
    ).toBe("/items?filter[status]=a%5Bb%5D%20c");
  });

  it("leaves a dot inside a member value unescaped, as RFC 3986 does", () => {
    expect(
      compose(filterTemplate("dot"), { filter: { status: "a.b" } })
        .pathAndQuery,
    ).toBe("/items?filter.status=a.b");
  });

  it("encodes a parameter name and a member name that need it", () => {
    const template = createRequestTemplate({
      method: "GET",
      route: "/items",
      parameters: [
        {
          name: "f o",
          location: "query",
          kind: "object",
          notation: "bracket",
          members: [{ name: "a b", kind: "string" }],
        },
      ],
    });
    expect(compose(template, { "f o": { "a b": "x" } }).pathAndQuery).toBe(
      "/items?f%20o[a%20b]=x",
    );
  });

  it("renames the group as a whole", () => {
    expect(
      compose(filterTemplate("dot", { argument: "f" }), {
        f: { status: "x" },
      }).pathAndQuery,
    ).toBe("/items?filter.status=x");
  });

  it("applies the scalar type gate to each member", () => {
    expectError(
      () => compose(filterTemplate("dot"), { filter: { min: "3" } }),
      "invalid_type",
    );
    expectError(
      () => compose(filterTemplate("dot"), { filter: { tags: "a" } }),
      "invalid_type",
    );
    expect(
      compose(filterTemplate("dot"), { filter: { min: 1.0 } }).pathAndQuery,
    ).toBe("/items?filter.min=1");
  });

  it("rejects a non-object where the group is expected", () => {
    expectError(
      () => compose(filterTemplate("dot"), { filter: "status=a" }),
      "invalid_type",
    );
    expectError(
      () => compose(filterTemplate("dot"), { filter: ["a"] }),
      "invalid_type",
    );
  });

  it("rejects null, both on the group and on a member", () => {
    expectError(
      () => compose(filterTemplate("dot"), { filter: null }),
      "null_not_allowed",
    );
    expectError(
      () => compose(filterTemplate("dot"), { filter: { status: null } }),
      "null_not_allowed",
    );
  });

  it("rejects a member the template never declared, naming it dotted", () => {
    const error = expectError(
      () => compose(filterTemplate("bracket"), { filter: { statu: "a" } }),
      "unknown_argument",
    );
    expect(error.message).toContain("filter.statu");
    expect(error.message).toContain("filter.status");
  });

  it("names the agent's own key when the group is renamed", () => {
    const error = expectError(
      () =>
        compose(filterTemplate("dot", { argument: "f" }), {
          f: { nope: "a" },
        }),
      "unknown_argument",
    );
    expect(error.message).toContain("f.nope");
  });
});
