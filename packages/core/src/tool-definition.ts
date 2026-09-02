import type { EndpointDescriptor } from "./generated/endpoint-descriptor.js";
import type {
  ToolAnnotations,
  ToolDefinition,
} from "./generated/tool-definition.js";
import { createToolName } from "./naming.js";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function describe(
  schema: JsonRecord,
  description: string | undefined,
): JsonRecord {
  const clone = structuredClone(schema);
  if (
    description !== undefined &&
    description.trim() !== "" &&
    clone["description"] == null
  ) {
    clone["description"] = description;
  }
  return clone;
}

function buildInputSchema(endpoint: EndpointDescriptor): JsonRecord {
  const properties: JsonRecord = {};
  const required: string[] = [];

  for (const parameter of endpoint.parameters ?? []) {
    properties[parameter.name] = describe(
      parameter.schema,
      parameter.description,
    );
    if (parameter.required) {
      required.push(parameter.name);
    }
  }

  const body = endpoint.requestBody?.schema;
  if (body !== undefined) {
    const bodyProperties = body["properties"];
    if (isRecord(bodyProperties)) {
      for (const [name, schema] of Object.entries(bodyProperties)) {
        properties[name] = structuredClone(schema);
      }
    }
    const bodyRequired = body["required"];
    if (Array.isArray(bodyRequired)) {
      for (const name of bodyRequired) {
        if (typeof name === "string") {
          required.push(name);
        }
      }
    }
  }

  return { type: "object", properties, required };
}

function annotate(method: string): ToolAnnotations {
  switch (method.toUpperCase()) {
    case "GET":
    case "HEAD":
      return { readOnlyHint: true, idempotentHint: true };
    case "POST":
      return { destructiveHint: false };
    case "PUT":
      return { destructiveHint: true, idempotentHint: true };
    case "PATCH":
      return { destructiveHint: true };
    case "DELETE":
      return { destructiveHint: true, idempotentHint: true };
    default:
      return {};
  }
}

export function createToolDefinition(
  endpoint: EndpointDescriptor,
): ToolDefinition {
  const description =
    endpoint.description === undefined || endpoint.description.trim() === ""
      ? `${endpoint.method} ${endpoint.route}`
      : endpoint.description;
  return {
    name: createToolName(endpoint),
    description,
    inputSchema: buildInputSchema(endpoint),
    annotations: annotate(endpoint.method),
    auth: endpoint.auth,
  };
}
