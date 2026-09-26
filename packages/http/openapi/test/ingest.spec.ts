import { buildCatalog, compose, severityIn } from "@liaiso/core";
import { describe, expect, it } from "vitest";
import { ingest, type IngestionResult } from "../src/index.js";

const petstore = {
  openapi: "3.0.3",
  info: { title: "Pets", version: "1" },
  servers: [{ url: "https://api.example.test/v1" }],
  components: {
    securitySchemes: {
      ApiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
      Session: { type: "apiKey", in: "cookie", name: "ssb_at" },
    },
    schemas: {
      Pet: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "integer", readOnly: true },
          name: { type: "string", example: "Rex" },
          tag: { type: "string", nullable: true, default: "none" },
          owner: { $ref: "#/components/schemas/Owner" },
        },
      },
      Owner: {
        type: "object",
        properties: {
          name: { type: "string" },
          pets: { type: "array", items: { $ref: "#/components/schemas/Pet" } },
        },
      },
      Status: { type: "string", enum: ["a", "b"] },
    },
  },
  security: [{ ApiKey: [] }, { Session: [] }],
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        tags: ["Pets"],
        summary: "List pets",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" } },
          {
            name: "status",
            in: "query",
            schema: {
              allOf: [{ $ref: "#/components/schemas/Status" }],
              nullable: true,
            },
          },
          {
            name: "tags",
            in: "query",
            schema: { type: "array", items: { type: "string" } },
          },
          { name: "lang", in: "cookie", schema: { type: "string" } },
          { name: "ssb_at", in: "cookie", schema: { type: "string" } },
          { name: "JSESSIONID", in: "cookie", schema: { type: "string" } },
          { name: "Authorization", in: "header", schema: { type: "string" } },
          { name: "X-API-Key", in: "header", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Pet" },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Pets"],
        requestBody: {
          required: true,
          content: {
            "application/xml": { schema: { $ref: "#/components/schemas/Pet" } },
            "application/json": {
              schema: { $ref: "#/components/schemas/Pet" },
            },
          },
        },
        responses: { "201": { description: "created" } },
      },
    },
    "/pets/{petId}": {
      parameters: [
        {
          name: "petId",
          in: "path",
          required: true,
          schema: { type: "integer" },
        },
      ],
      delete: {
        operationId: "deletePet",
        security: [],
        responses: { "204": { description: "gone" } },
      },
      trace: { responses: { "200": { description: "echo" } } },
    },
  },
};

const endpointAt = (result: IngestionResult, key: string) =>
  result.endpoints.find((endpoint) => (endpoint.key as string) === key);

function catalogOf(result: IngestionResult) {
  return buildCatalog(
    result.endpoints.map((endpoint) => ({
      source: { key: endpoint.key },
      owner: endpoint.key,
      descriptor: endpoint.descriptor,
      operation: "include" as const,
      declare: (tags) => ({
        ...endpoint.descriptor,
        ...(tags === undefined ? {} : { tags: [...tags] }),
      }),
      ...(endpoint.descriptor.tags === undefined
        ? {}
        : { tags: endpoint.descriptor.tags }),
    })),
    {
      selection: { default: "exclude" },
      providers: new Set<string>(),
      severity: (code) => severityIn({}, code),
      failOn: "fatal",
    },
  );
}

describe("ingest: OpenAPI 3.0", () => {
  it("lowers operations into descriptors the catalog accepts", async () => {
    const result = await ingest(petstore);
    expect(result.fatal).toBe(false);
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("unsupported_method");
    expect(codes).toContain("reserved_header_parameter_ignored");
    expect(codes).toContain("credential_parameter_ignored");
    expect(codes).toContain("identity_cookie_parameter");
    expect(codes).toContain("request_media_type_alternative_ignored");
    expect(codes).toContain("identity_cookie_uncovered");

    const list = endpointAt(result, "GET /pets");
    expect(list?.baseUrl).toBe("https://api.example.test/v1");
    expect(
      list?.descriptor.parameters?.map((p) => `${p.in}:${p.name}`),
    ).toEqual(["query:limit", "query:status", "query:tags", "cookie:lang"]);
    expect(list?.descriptor.auth.carriers).toEqual([
      { in: "header", name: "X-API-Key" },
      { in: "cookie", name: "ssb_at" },
      { in: "cookie", name: "JSESSIONID" },
    ]);
    const status = list?.descriptor.parameters?.find(
      (p) => p.name === "status",
    );
    expect(status?.schema).toEqual({
      type: ["string", "null"],
      enum: ["a", "b", null],
    });

    const create = endpointAt(result, "POST /pets");
    const body = create?.descriptor.requestBody?.schema;
    expect(body?.properties?.["id"]).toBeUndefined();
    expect(body?.required).toEqual(["name"]);
    expect(body?.properties?.["tag"]).toEqual({ type: ["string", "null"] });
    expect(body?.properties?.["name"]).toEqual({
      type: "string",
      examples: ["Rex"],
    });
    expect(Object.keys(body?.$defs ?? {}).sort()).toEqual(["Owner", "Pet"]);

    const remove = endpointAt(result, "DELETE /pets/{petId}");
    expect(remove?.descriptor.auth.anonymous).toBe("yes");

    const catalog = catalogOf(result);
    expect(catalog.fatal).toEqual([]);
    expect([...catalog.byName.keys()].sort()).toEqual([
      "delete_pet",
      "list_pets",
      "post_pets",
    ]);
    const listTool = catalog.byName.get("list_pets");
    const composed = compose(listTool!.template!, {
      lang: "tr",
      tags: ["a", "b"],
      limit: 5,
    });
    expect(composed.pathAndQuery).toBe("/pets?limit=5&tags=a&tags=b");
    expect(composed.headers).toEqual({ cookie: "lang=tr" });
  });

  it("extends the cookie deny-list with named identity cookies", async () => {
    const result = await ingest(petstore, { identityCookies: ["LANG"] });
    const list = endpointAt(result, "GET /pets");

    expect(
      list?.descriptor.parameters?.map((p) => `${p.in}:${p.name}`),
    ).toEqual(["query:limit", "query:status", "query:tags"]);
    expect(list?.descriptor.auth.carriers).toEqual(
      expect.arrayContaining([
        { in: "cookie", name: "lang" },
        { in: "cookie", name: "ssb_at" },
        { in: "cookie", name: "JSESSIONID" },
      ]),
    );
  });

  it("refuses an external reference without a loader", async () => {
    const result = await ingest({
      openapi: "3.1.0",
      info: { title: "x", version: "1" },
      paths: {
        "/a": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": { schema: { $ref: "other.json#/X" } },
                },
              },
            },
          },
        },
      },
    });
    expect(result.fatal).toBe(true);
    expect(result.diagnostics[0]?.code).toBe("external_ref_blocked");
  });
});

describe("ingest: Swagger 2.0", () => {
  it("upgrades parameters, form bodies and servers", async () => {
    const result = await ingest({
      swagger: "2.0",
      info: { title: "x", version: "1" },
      host: "api.example.test",
      basePath: "/base",
      schemes: ["http", "https"],
      paths: {
        "/upload": {
          post: {
            operationId: "upload",
            consumes: ["multipart/form-data"],
            parameters: [
              {
                name: "ids",
                in: "query",
                type: "array",
                items: { type: "integer" },
                collectionFormat: "pipes",
              },
              { name: "file", in: "formData", type: "file", required: true },
              { name: "note", in: "formData", type: "string" },
              {
                name: "bad",
                in: "header",
                type: "array",
                items: { type: "string" },
                collectionFormat: "tsv",
              },
            ],
            responses: {
              "200": {
                description: "ok",
                schema: { $ref: "#/definitions/Result" },
              },
            },
          },
        },
      },
      definitions: {
        Result: { type: "object", properties: { ok: { type: "boolean" } } },
      },
    });
    expect(result.diagnostics.map((d) => d.code)).toEqual([
      "unsupported_collection_format",
    ]);
    expect(result.endpoints).toEqual([]);

    const clean = await ingest({
      swagger: "2.0",
      info: { title: "x", version: "1" },
      host: "api.example.test",
      basePath: "/base",
      schemes: ["http", "https"],
      paths: {
        "/upload": {
          post: {
            operationId: "upload",
            consumes: ["multipart/form-data"],
            parameters: [
              {
                name: "ids",
                in: "query",
                type: "array",
                items: { type: "integer" },
                collectionFormat: "pipes",
              },
              { name: "file", in: "formData", type: "file", required: true },
              { name: "note", in: "formData", type: "string" },
            ],
            responses: {
              "200": {
                description: "ok",
                schema: { $ref: "#/definitions/Result" },
              },
            },
          },
        },
      },
      definitions: {
        Result: { type: "object", properties: { ok: { type: "boolean" } } },
      },
    });
    const upload = clean.endpoints[0];
    expect(upload?.baseUrl).toBe("https://api.example.test/base");
    expect(upload?.descriptor.parameters).toEqual([
      {
        name: "ids",
        in: "query",
        required: false,
        schema: { type: "array", items: { type: "integer" } },
        style: "pipeDelimited",
        explode: false,
      },
    ]);
    expect(upload?.descriptor.requestBody).toEqual({
      contentType: "multipart/form-data",
      schema: {
        type: "object",
        properties: {
          file: {
            type: "string",
            contentMediaType: "application/octet-stream",
          },
          note: { type: "string" },
        },
        required: ["file"],
      },
    });
    expect(upload?.descriptor.responses?.["200"]?.schema).toEqual({
      type: "object",
      properties: { ok: { type: "boolean" } },
    });
    expect(catalogOf(clean).fatal).toEqual([]);
  });
});
