import { describe, expect, it } from "vitest";
import { searchParameters, summarizeParameters } from "../src/card.js";
import type { JsonSchemaObject } from "../src/generated/endpoint-descriptor.js";

const asSchema = (schema: unknown): JsonSchemaObject =>
  schema as JsonSchemaObject;

describe("summarizeParameters projection", () => {
  const summarize = (schema: unknown): string =>
    summarizeParameters(asSchema(schema));

  it("names each property with its type and marks the required ones", () => {
    expect(
      summarize({
        type: "object",
        properties: { id: { type: "integer" }, note: { type: "string" } },
        required: ["id"],
      }),
    ).toBe("id: integer (required), note: string");
  });

  it("treats a missing, null or non-object properties bag as empty", () => {
    expect(summarize({ type: "object" })).toBe("");
    expect(summarize({ properties: {} })).toBe("");
    expect(summarize({ properties: null })).toBe("");
    expect(summarize({ properties: "ab" })).toBe("");
    expect(summarize({ properties: ["a", "b"] })).toBe("");
  });

  it("falls back to any when the member or its type is not usable", () => {
    expect(
      summarize({
        properties: {
          boolean: true,
          nulled: null,
          typeless: {},
          numericType: { type: 42 },
          nullUnion: { type: ["null"] },
        },
      }),
    ).toBe(
      "boolean: any, nulled: any, typeless: any, numericType: any, nullUnion: any",
    );
  });

  it("skips a non-string union member rather than naming it", () => {
    expect(summarize({ properties: { mixed: { type: [42, "string"] } } })).toBe(
      "mixed: string",
    );
  });

  it("ignores a required list that is not an array of strings", () => {
    expect(
      summarize({ properties: { id: { type: "integer" } }, required: "id" }),
    ).toBe("id: integer");
    expect(
      summarize({ properties: { id: { type: "integer" } }, required: [42] }),
    ).toBe("id: integer");
  });
});

describe("searchParameters projection", () => {
  const project = (schema: unknown): readonly string[] =>
    searchParameters(asSchema(schema));

  it("emits each root key and its string description", () => {
    expect(
      project({
        type: "object",
        properties: {
          customerId: { type: "integer", description: "Musteri numarasi" },
          page: { type: "integer" },
        },
      }),
    ).toEqual(["customerId", "Musteri numarasi", "page"]);
  });

  it("stops at the root: nested members and $defs contribute nothing", () => {
    expect(
      project({
        type: "object",
        properties: {
          filter: {
            type: "object",
            description: "Filtre govdesi",
            properties: { tenantId: { type: "integer" } },
          },
        },
        $defs: { TenantRef: { properties: { tenantCode: {} } } },
      }),
    ).toEqual(["filter", "Filtre govdesi"]);
  });

  it("treats a missing, null or non-object properties bag as empty", () => {
    expect(project({ type: "object" })).toEqual([]);
    expect(project({ properties: {} })).toEqual([]);
    expect(project({ properties: null })).toEqual([]);
    expect(project({ properties: "ab" })).toEqual([]);
    expect(project({ properties: ["a", "b"] })).toEqual([]);
  });

  it("keeps the key when the member or its description is not usable", () => {
    expect(
      project({
        properties: {
          boolean: true,
          nulled: null,
          numeric: { description: 42 },
          objectish: { description: { text: "no" } },
          voided: { description: null },
        },
      }),
    ).toEqual(["boolean", "nulled", "numeric", "objectish", "voided"]);
  });
});
