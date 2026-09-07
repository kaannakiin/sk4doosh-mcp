import type { JsonSchemaObject } from "./generated/endpoint-descriptor.js";

export type JsonSchemaType = Extract<
  NonNullable<JsonSchemaObject["type"]>,
  string
>;

export type ObjectSchema = JsonSchemaObject & {
  type: "object";
  properties: Record<string, JsonSchemaObject>;
  required: string[];
  additionalProperties: boolean;
};

export function typeOf(
  schema: JsonSchemaObject | undefined,
): JsonSchemaType | undefined {
  const type = schema?.type;
  if (typeof type === "string") {
    return type;
  }
  if (Array.isArray(type)) {
    return type.find((candidate) => candidate !== "null");
  }
  return undefined;
}

export function isObjectSchema(schema: JsonSchemaObject): boolean {
  return typeOf(schema) === "object";
}

export function allowsAdditional(
  schema: JsonSchemaObject | undefined,
): boolean {
  const additional = schema?.additionalProperties;
  if (typeof additional === "boolean") {
    return additional;
  }
  return additional !== undefined;
}

export interface FlattenableBody {
  readonly properties: Readonly<Record<string, JsonSchemaObject>>;
  readonly required: readonly string[];
}

export function flattenableBody(
  schema: JsonSchemaObject | undefined,
): FlattenableBody | undefined {
  const properties = schema?.properties;
  if (properties === undefined) {
    return undefined;
  }
  const required = schema?.required;
  return { properties, required: Array.isArray(required) ? required : [] };
}
