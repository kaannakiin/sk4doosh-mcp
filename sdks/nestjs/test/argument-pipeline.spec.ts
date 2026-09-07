import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRequestTemplate, SkMcpArgumentError } from "../src/index.js";
import { createApp, hits, type TestApp } from "./hosts.js";

let app: TestApp;

beforeEach(async () => {
  hits.admin = 0;
  app = await createApp();
});

afterEach(async () => {
  await app.close();
});

describe("argument mapping through the pipeline", () => {
  it("A1: a traversal attempt stays one encoded segment and never reaches /admin", async () => {
    const template = createRequestTemplate({
      method: "GET",
      route: "/files/{name}",
      parameters: [{ name: "name", location: "path", kind: "string" }],
    });
    const result = await app.dispatcher.dispatch(template, {
      name: "5/../admin",
    });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body).name).toBe("5/../admin");
    expect(hits.admin).toBe(0);
  });

  it("A2: a query value with separators arrives as one parameter", async () => {
    const template = createRequestTemplate({
      method: "GET",
      route: "/items",
      parameters: [{ name: "q", location: "query", kind: "string" }],
    });
    const result = await app.dispatcher.dispatch(template, {
      q: "a&admin=true",
    });
    expect(JSON.parse(result.body)).toEqual({ q: "a&admin=true" });
  });

  it("A3: header injection dies before any dispatch happens", async () => {
    const template = createRequestTemplate({
      method: "GET",
      route: "/items",
      parameters: [{ name: "X-Data", location: "header", kind: "string" }],
    });
    await expect(
      app.dispatcher.dispatch(template, { "X-Data": "x\r\nInjected: 1" }),
    ).rejects.toSatisfy(
      (error) =>
        error instanceof SkMcpArgumentError &&
        error.code === "header_injection",
    );
  });

  it("A7: an array query parameter binds repeat-key style", async () => {
    const template = createRequestTemplate({
      method: "GET",
      route: "/items",
      parameters: [
        { name: "tag", location: "query", kind: "string", isArray: true },
      ],
    });
    const result = await app.dispatcher.dispatch(template, { tag: ["a", "b"] });
    expect(JSON.parse(result.body)).toEqual({ tag: ["a", "b"] });
  });

  it("A9: flattened body fields bind with the pinned content type", async () => {
    const template = createRequestTemplate({
      method: "POST",
      route: "/orders/{id}/notes",
      parameters: [
        { name: "id", location: "path", kind: "integer" },
        { name: "notify", location: "query", kind: "boolean" },
      ],
      bodyProperties: ["text"],
    });
    const result = await app.dispatcher.dispatch(template, {
      id: 5,
      notify: true,
      text: "geç kaldı",
    });
    expect(result.status).toBe(201);
    const echo = JSON.parse(result.body);
    expect(echo.id).toBe("5");
    expect(echo.notify).toBe("true");
    expect(echo.body).toEqual({ text: "geç kaldı" });
    expect(echo.contentType).toBe("application/json; charset=utf-8");
  });
});
