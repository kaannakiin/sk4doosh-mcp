import { describe, expect, it } from "vitest";
import { curatedDescriptions } from "../src/curation.js";
import type {
  EndpointDescriptor,
  ToolVariant,
} from "../src/generated/endpoint-descriptor.js";

const endpoint: EndpointDescriptor = {
  operationId: "GetOrder",
  method: "GET",
  route: "/orders/{id}",
  description: "Fetches one order.",
  parameters: [
    {
      name: "id",
      in: "path",
      required: true,
      schema: { type: "integer", description: "Internal row id." },
      description: "Row id",
    },
    {
      name: "tenantId",
      in: "query",
      required: true,
      schema: { type: "string", description: "Owning tenant." },
    },
  ],
  arguments: [
    { name: "id", description: "The order's public identifier." },
    { name: "tenantId", hidden: { kind: "deferred", source: "tenant" } },
  ],
  auth: { anonymous: "yes", policies: [], imperative: false },
};

describe("curatedDescriptions", () => {
  it("returns only the descriptions the host declared while curating", () => {
    expect(curatedDescriptions(endpoint, undefined)).toEqual([
      "The order's public identifier.",
    ]);
  });

  it("never returns a description inherited from the operation's own types", () => {
    const returned = curatedDescriptions(endpoint, undefined);
    expect(returned).not.toContain("Internal row id.");
    expect(returned).not.toContain("Row id");
    expect(returned).not.toContain("Owning tenant.");
  });

  it("takes the variant's record whole, so a variant drops the endpoint's description", () => {
    const variant: ToolVariant = {
      name: "get_order_public",
      description: "Fetches one order by its public identifier.",
      arguments: [{ name: "id", as: "order_id" }],
    };
    expect(curatedDescriptions(endpoint, variant)).toEqual([]);
  });

  it("returns the variant's own description when it declares one", () => {
    const variant: ToolVariant = {
      name: "get_order_public",
      description: "Fetches one order by its public identifier.",
      arguments: [{ name: "id", description: "Public order code." }],
    };
    expect(curatedDescriptions(endpoint, variant)).toEqual([
      "Public order code.",
    ]);
  });

  it("is empty when nothing is curated", () => {
    const { arguments: _curated, ...bare } = endpoint;
    expect(curatedDescriptions(bare, undefined)).toEqual([]);
  });
});
