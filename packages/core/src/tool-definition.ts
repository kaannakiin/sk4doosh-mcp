import type { EndpointDescriptor } from "./generated/endpoint-descriptor.js";
import type {
  ToolAnnotations,
  ToolDefinition,
} from "./generated/tool-definition.js";
import { assertUniqueArgumentNames } from "./argument-names.js";
import { SkMcpTemplateError } from "./errors.js";
import type { JsonSchemaObject } from "./generated/endpoint-descriptor.js";
import {
  additionalPropertiesOf,
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

export type BodyRootReason = "optional" | "non_object" | "unflattenable_root";

/**
 * The body-root keys flattening consumes, preserves elsewhere, or drops by rule.
 *
 * `description` is dropped deliberately — flattening leaves no slot for it. `$defs` and
 * `additionalProperties` are carried to the tool root. Everything else here is consumed.
 */
const flattenableKeys = new Set([
  "type",
  "properties",
  "required",
  "$defs",
  "additionalProperties",
  "description",
]);

/**
 * Body-root keys that annotate without constraining, and so must not force root mode.
 *
 * The list has to be generous: root mode raises `argument_collision` when the endpoint already has a
 * parameter named `body`, so a key wrongly treated as a constraint turns a working tool into a
 * dropped one. `$schema` in particular is written by `zod-to-json-schema` and by any standalone
 * serialization, and reaches this predicate through a `verbatim` host schema.
 */
const ignoredKeys = new Set([
  "title",
  "$schema",
  "$id",
  "$anchor",
  "$comment",
  "example",
  "examples",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
]);

/**
 * Names the body-root key that flattening would silently discard, if there is one.
 *
 * @returns the key, for a diagnostic to name; `undefined` when every key is safe.
 */
export function unflattenableRootKey(
  body: JsonSchemaObject,
): string | undefined {
  if (Array.isArray(body.type)) {
    return "type";
  }
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) {
      continue;
    }
    if (
      flattenableKeys.has(key) ||
      ignoredKeys.has(key) ||
      key.startsWith("x-")
    ) {
      continue;
    }
    return key;
  }
  return undefined;
}

/**
 * Decides whether the body travels as one synthetic argument instead of flattening.
 *
 * Flattening preserves a body root's `properties` and `required` and nothing else, so it is allowed
 * only for a root that carries nothing else worth keeping. The direction is deliberate: an
 * unrecognised keyword wraps the body rather than dropping the keyword, because a wrapped body is
 * complete and merely less ergonomic, while a dropped keyword publishes a contract the backend does
 * not honour. `minProperties` and `propertyNames` are the clearest cases — both count or match
 * *every* key, and after flattening the tool root's keys include the path and query parameters.
 *
 * @param required the body-level `requestBody.required`; `false` forces root mode, because a
 * flattened body has no wrapper left to omit and would always send `{}`.
 * @returns why the body needs a root argument, or `undefined` to flatten its fields.
 */
export function bodyRootReasonOf(
  body: JsonSchemaObject | undefined,
  required?: boolean,
): BodyRootReason | undefined {
  if (body === undefined) {
    return undefined;
  }
  if (required === false) {
    return "optional";
  }
  const type = typeOf(body);
  if (type !== undefined && type !== "object") {
    return "non_object";
  }
  if (unflattenableRootKey(body) !== undefined) {
    return "unflattenable_root";
  }
  if (body.properties === undefined && !allowsAdditional(body)) {
    return "unflattenable_root";
  }
  return undefined;
}

/**
 * @returns the synthetic argument name, or `undefined` to flatten the body's fields.
 */
export function bodyRootOf(
  body: JsonSchemaObject | undefined,
  required?: boolean,
): string | undefined {
  return bodyRootReasonOf(body, required) === undefined
    ? undefined
    : bodyRootArgument;
}

type InputSchema = Omit<ObjectSchema, "additionalProperties"> & {
  additionalProperties: boolean | JsonSchemaObject;
};

function buildInputSchema(endpoint: EndpointDescriptor): InputSchema {
  const parameters = endpoint.parameters ?? [];
  const body = endpoint.requestBody?.schema;
  const bodyRequired = endpoint.requestBody?.required;
  const root = bodyRootOf(body, bodyRequired);
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
    if (bodyRequired !== false) {
      require(root);
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

  const schema: InputSchema = {
    type: "object",
    properties,
    required,
    additionalProperties: root === undefined && additionalPropertiesOf(body),
  };
  const defs = liftDefs(
    properties,
    root === undefined ? body?.$defs : undefined,
  );
  if (defs !== undefined) {
    schema.$defs = defs;
  }
  return schema;
}

/**
 * Renders a value with every object's keys in sorted order.
 *
 * The `$defs` conflict check MUST NOT see two spellings of one schema as two schemas. Plain
 * `JSON.stringify` is key-order sensitive while the .NET side compares with `JsonNode.DeepEquals`,
 * which is not — so a parameter bag and a body bag carrying the same type in a different key order
 * would drop the endpoint here and build the tool there.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const bag = value as Record<string, unknown>;
    return `{${Object.keys(bag)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(bag[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Merges every `$defs` bag reachable from the tool's own root into one.
 *
 * @param seed the flattened body's own root bag. A flattened body contributes its properties to
 * `properties` but its root — and therefore its bag — is never emitted, so without this the `$ref`s
 * lifted out of it would point at nothing. It is cloned and its source is left intact: the
 * descriptor is shared across the catalog snapshot, so stripping `$defs` from it would break every
 * tool built after the first.
 * @throws SkMcpTemplateError `schema_def_conflict` when one key carries two different schemas.
 */
function liftDefs(
  properties: Record<string, JsonSchemaObject>,
  seed: Record<string, JsonSchemaObject> | undefined,
): Record<string, JsonSchemaObject> | undefined {
  const merged: Record<string, JsonSchemaObject> = {};
  let found = false;
  const take = (name: string, body: JsonSchemaObject): void => {
    const existing = merged[name];
    if (existing !== undefined) {
      if (canonical(existing) !== canonical(body)) {
        throw new SkMcpTemplateError(
          "schema_def_conflict",
          `Two schemas define '${name}' differently; the tool cannot be built.`,
        );
      }
      return;
    }
    merged[name] = body;
    found = true;
  };

  if (seed !== undefined) {
    for (const [name, body] of Object.entries(seed)) {
      take(name, structuredClone(body));
    }
  }
  for (const schema of Object.values(properties)) {
    const own = schema.$defs;
    if (own === undefined) {
      continue;
    }
    delete schema.$defs;
    for (const [name, body] of Object.entries(own)) {
      take(name, body);
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
