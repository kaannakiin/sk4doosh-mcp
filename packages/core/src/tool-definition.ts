import type { EndpointDescriptor } from "./generated/endpoint-descriptor.js";
import type {
  ToolAnnotations,
  ToolDefinition,
} from "./generated/tool-definition.js";
import { assertUniqueArgumentNames } from "./argument-names.js";
import { SkMcpTemplateError } from "./errors.js";
import type { JsonSchemaObject } from "./generated/endpoint-descriptor.js";
import {
  allowsAdditional,
  flattenableBody,
  typeOf,
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

export const bodyRootArgument = "body";

export function bodyRootOf(
  body: JsonSchemaObject | undefined,
): string | undefined {
  if (body === undefined) {
    return undefined;
  }
  const type = typeOf(body);
  return type === undefined || type === "object" ? undefined : bodyRootArgument;
}

function buildInputSchema(endpoint: EndpointDescriptor): ObjectSchema {
  const parameters = endpoint.parameters ?? [];
  const body = endpoint.requestBody?.schema;
  const root = bodyRootOf(body);
  const flattened = root === undefined ? flattenableBody(body) : undefined;

  assertUniqueArgumentNames(
    parameters.map((parameter) => parameter.name),
    root !== undefined
      ? [root]
      : flattened === undefined
        ? []
        : Object.keys(flattened.properties),
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

  if (root !== undefined && body !== undefined) {
    properties[root] = structuredClone(body);
    require(root);
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

  const schema: ObjectSchema = {
    type: "object",
    properties,
    required,
    additionalProperties: root === undefined && allowsAdditional(body),
  };
  const defs = liftDefs(properties);
  if (defs !== undefined) {
    schema.$defs = defs;
  }
  return schema;
}

function liftDefs(
  properties: Record<string, JsonSchemaObject>,
): Record<string, JsonSchemaObject> | undefined {
  const merged: Record<string, JsonSchemaObject> = {};
  let found = false;
  for (const schema of Object.values(properties)) {
    const own = schema.$defs;
    if (own === undefined) {
      continue;
    }
    delete schema.$defs;
    for (const [name, body] of Object.entries(own)) {
      const existing = merged[name];
      if (existing !== undefined) {
        if (JSON.stringify(existing) !== JSON.stringify(body)) {
          throw new SkMcpTemplateError(
            "schema_def_conflict",
            `Two schemas define '${name}' differently; the tool cannot be built.`,
          );
        }
        continue;
      }
      merged[name] = body;
      found = true;
    }
  }
  if (!found) {
    return undefined;
  }
  const ordered: Record<string, JsonSchemaObject> = {};
  for (const name of Object.keys(merged).sort()) {
    ordered[name] = merged[name] as JsonSchemaObject;
  }
  return ordered;
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
  name?: string,
): ToolDefinition {
  const description =
    endpoint.description === undefined || endpoint.description.trim() === ""
      ? `${endpoint.method} ${endpoint.route}`
      : endpoint.description;
  return {
    name: name ?? createToolName(endpoint),
    description,
    inputSchema: buildInputSchema(endpoint),
    annotations: annotate(endpoint.method),
    auth: endpoint.auth,
  };
}
