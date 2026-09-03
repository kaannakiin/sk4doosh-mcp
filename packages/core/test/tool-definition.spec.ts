import { describe, expect, it } from "vitest";
import {
  createTool,
  createToolDefinition,
  SkMcpTemplateError,
} from "../src/index.js";
import type { EndpointDescriptor } from "../src/index.js";

const auth = { anonymous: "no", policies: [], imperative: false } as const;

function endpoint(overrides: Partial<EndpointDescriptor>): EndpointDescriptor {
  return {
    method: "POST",
    route: "/orders/{id}",
    auth,
    ...overrides,
  } as EndpointDescriptor;
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof SkMcpTemplateError ? error.code : undefined;
  }
  return undefined;
}

describe("createToolDefinition", () => {
  it("D1: a parameter description fills only a schema that carries none", () => {
    const tool = createToolDefinition(
      endpoint({
        method: "GET",
        route: "/orders/{id}",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "integer", description: "kendi aciklamasi" },
            description: "dis aciklama",
          },
        ],
      }),
    );
    expect(tool.inputSchema["properties"]).toEqual({
      id: { type: "integer", description: "kendi aciklamasi" },
    });
  });

  it("D3: a parameter name colliding with a body property throws argument_collision", () => {
    expect(
      codeOf(() =>
        createToolDefinition(
          endpoint({
            parameters: [
              { name: "id", in: "path", required: true, schema: { type: "integer" } },
            ],
            requestBody: {
              schema: {
                type: "object",
                properties: { id: { type: "integer" } },
              },
            },
          }),
        ),
      ),
    ).toBe("argument_collision");
  });

  it("D4: duplicate entries in the body required list collapse", () => {
    const tool = createToolDefinition(
      endpoint({
        route: "/orders",
        requestBody: {
          schema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text", "text"],
          },
        },
      }),
    );
    expect(tool.inputSchema["required"]).toEqual(["text"]);
  });

  it("D5: the root writes type, properties, required and additionalProperties even when empty", () => {
    const tool = createToolDefinition(endpoint({ method: "GET", route: "/ping" }));
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });

  it("D6: a request body without properties contributes nothing but opens the schema", () => {
    const tool = createToolDefinition(
      endpoint({
        route: "/orders",
        requestBody: { schema: { type: "object", additionalProperties: true } },
      }),
    );
    expect(tool.inputSchema).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: true,
    });
  });

  it("D7: a required entry naming an undeclared property is ignored", () => {
    const tool = createToolDefinition(
      endpoint({
        route: "/orders",
        requestBody: {
          schema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text", "ghost"],
          },
        },
      }),
    );
    expect(tool.inputSchema["required"]).toEqual(["text"]);
  });
});

describe("createTool", () => {
  it("D8: definition and template come from one descriptor", () => {
    const tool = createTool(
      endpoint({
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
        ],
        requestBody: {
          schema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
        },
      }),
    );
    expect(tool.definition.inputSchema["required"]).toEqual(["id", "text"]);
    expect(tool.template.hasBody).toBe(true);
    expect([...tool.template.bodyProperties]).toEqual(["text"]);
    expect(tool.template.parameters[0]?.kind).toBe("integer");
  });

  it("D9: both entry points reject the same collision identically", () => {
    const colliding = endpoint({
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "integer" } },
      ],
      requestBody: {
        schema: { type: "object", properties: { id: { type: "integer" } } },
      },
    });
    expect(codeOf(() => createToolDefinition(colliding))).toBe("argument_collision");
    expect(codeOf(() => createTool(colliding))).toBe("argument_collision");
  });
});
