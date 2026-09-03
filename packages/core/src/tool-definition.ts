import type { EndpointDescriptor } from "./generated/endpoint-descriptor.js";
import type {
  ToolAnnotations,
  ToolDefinition,
} from "./generated/tool-definition.js";
import { assertUniqueArgumentNames } from "./argument-names.js";
import type { JsonSchemaObject } from "./generated/endpoint-descriptor.js";
import {
  allowsAdditional,
  flattenableBody,
  type ObjectSchema,
} from "./json-schema.js";
import { createToolName } from "./naming.js";

function describe(
  schema: JsonSchemaObject,
  description: string | undefined,
): JsonSchemaObject {
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

function buildInputSchema(endpoint: EndpointDescriptor): ObjectSchema {
  const parameters = endpoint.parameters ?? [];
  const body = endpoint.requestBody?.schema;
  const flattened = flattenableBody(body);

  assertUniqueArgumentNames(
    parameters.map((parameter) => parameter.name),
    flattened === undefined ? [] : Object.keys(flattened.properties),
  );

  const properties: Record<string, JsonSchemaObject> = {};
  const required: string[] = [];
  const claimed = new Set<string>();
  const require = (name: string): void => {
    if (!claimed.has(name)) {
      claimed.add(name);
      required.push(name);
    }
  };

  for (const parameter of parameters) {
    properties[parameter.name] = describe(
      parameter.schema,
      parameter.description,
    );
    if (parameter.required) {
      require(parameter.name);
    }
  }

  if (flattened !== undefined) {
    for (const [name, schema] of Object.entries(flattened.properties)) {
      properties[name] = structuredClone(schema);
    }
    for (const name of flattened.required) {
      if (Object.hasOwn(properties, name)) {
        require(name);
      }
    }
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: allowsAdditional(body),
  };
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
