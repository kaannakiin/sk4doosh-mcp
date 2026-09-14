import { describe, expect, it } from "vitest";
import {
  arraySeparatorFor,
  createRequestTemplate,
  SkMcpTemplateError,
} from "../src/index.js";

describe("createRequestTemplate", () => {
  it("strips route constraints from placeholders", () => {
    const template = createRequestTemplate({
      method: "GET",
      route: "/orders/{id:int}",
      parameters: [{ name: "id", location: "path", kind: "integer" }],
    });
    expect(template.routeTemplate).toBe("/orders/{id}");
  });

  it("rejects a body on GET and HEAD", () => {
    for (const method of ["GET", "HEAD"]) {
      expect(() =>
        createRequestTemplate({
          method,
          route: "/items",
          bodyProperties: ["text"],
        }),
      ).toThrow(SkMcpTemplateError);
    }
  });

  it("rejects duplicate parameter names", () => {
    expect(() =>
      createRequestTemplate({
        method: "GET",
        route: "/items",
        parameters: [
          { name: "q", location: "query", kind: "string" },
          { name: "q", location: "header", kind: "string" },
        ],
      }),
    ).toThrow("Duplicate argument name 'q'.");
  });

  it("rejects header parameters named like identity carriers", () => {
    for (const name of ["Authorization", "authorization", "Cookie", "cookie"]) {
      expect(() =>
        createRequestTemplate({
          method: "GET",
          route: "/items",
          parameters: [{ name, location: "header", kind: "string" }],
        }),
      ).toThrow(SkMcpTemplateError);
    }
  });

  it("rejects array path parameters", () => {
    expect(() =>
      createRequestTemplate({
        method: "GET",
        route: "/items/{id}",
        parameters: [
          { name: "id", location: "path", kind: "string", isArray: true },
        ],
      }),
    ).toThrow("cannot be an array");
  });

  it("rejects body properties colliding with parameter names", () => {
    expect(() =>
      createRequestTemplate({
        method: "PUT",
        route: "/orders/{id}",
        parameters: [{ name: "id", location: "path", kind: "integer" }],
        bodyProperties: ["id"],
      }),
    ).toThrow("collides with a parameter name");
  });

  it("rejects path parameters without a route placeholder", () => {
    expect(() =>
      createRequestTemplate({
        method: "GET",
        route: "/items",
        parameters: [{ name: "id", location: "path", kind: "integer" }],
      }),
    ).toThrow("has no '{id}' placeholder");
  });

  it("rejects route placeholders without a declared path parameter", () => {
    expect(() =>
      createRequestTemplate({ method: "GET", route: "/items/{id}" }),
    ).toThrow("has no declared path parameter");
  });

  it("rejects a header array that would have to repeat the key", () => {
    expect(() =>
      createRequestTemplate({
        method: "GET",
        route: "/items",
        parameters: [
          { name: "x-tag", location: "header", kind: "string", isArray: true },
        ],
      }),
    ).toThrow("a header cannot carry");
  });
});

describe("arraySeparatorFor", () => {
  it("defaults to repeating the key", () => {
    expect(arraySeparatorFor(undefined, undefined, "tag")).toBeUndefined();
    expect(arraySeparatorFor("form", true, "tag")).toBeUndefined();
  });

  it("maps each style to its delimiter", () => {
    expect(arraySeparatorFor("form", false, "tag")).toBe(",");
    expect(arraySeparatorFor("spaceDelimited", false, "tag")).toBe(" ");
    expect(arraySeparatorFor("pipeDelimited", false, "tag")).toBe("|");
  });

  it("rejects a delimited style that also explodes", () => {
    for (const style of ["spaceDelimited", "pipeDelimited"] as const) {
      expect(() => arraySeparatorFor(style, true, "tag")).toThrow(
        SkMcpTemplateError,
      );
      expect(() => arraySeparatorFor(style, undefined, "tag")).toThrow(
        "has no wire form",
      );
    }
  });
});
