export type JsonSchemaDocument = Readonly<Record<string, unknown>>;

const MAX_SERIALIZED_BYTES = 8192;

const MAX_DEPTH = 8;

/**
 * Guard: `$comment` is stripped with the rest because it is free text a server
 * author wrote, and it travels into the provider request next to the tool's
 * description — one more place to write an instruction aimed at the model.
 */
const META_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$anchor",
  "$defs",
  "definitions",
  "$comment",
]);

export const OPAQUE_TOOL_INPUT_SCHEMA: JsonSchemaDocument = Object.freeze({
  type: "object",
  additionalProperties: true,
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strip(value: unknown, depth: number): unknown | undefined {
  if (depth > MAX_DEPTH) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => strip(item, depth + 1));

    return items.includes(undefined) ? undefined : items;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  if ("$ref" in value || "$dynamicRef" in value) {
    return undefined;
  }

  /**
   * Guard: assembled through a `Map` rather than by indexing a plain object, so
   * a property literally named `__proto__` cannot reach the object's prototype.
   * The document is written by a server this platform has not met.
   */
  const kept = new Map<string, unknown>();
  for (const [key, entry] of Object.entries(value)) {
    if (META_KEYWORDS.has(key)) {
      continue;
    }

    const cleaned = strip(entry, depth + 1);
    if (cleaned === undefined) {
      return undefined;
    }

    kept.set(key, cleaned);
  }

  return Object.fromEntries(kept);
}

/**
 * Makes a remote server's JSON Schema safe to forward to a model provider.
 *
 * Guard: `jsonSchema()` does not validate, so the document reaches the provider
 * verbatim. A `$ref`, an unknown draft, or a non-object root earns a 400 on the
 * whole request — every tool in the turn dies, not the one that is malformed.
 * Anything this function cannot vouch for degrades to an opaque object schema
 * and the remote server is left to reject bad arguments itself.
 *
 * Guard: a `$ref` anywhere collapses the document rather than being pruned in
 * place. Dropping one branch of an `anyOf` silently changes what the schema
 * accepts, and a schema that lies about its own shape is worse than one that
 * says nothing.
 *
 * @param document the `inputSchema` as the server published it
 * @returns the document with meta keywords removed, or an opaque object schema
 */
export function sanitizeToolInputSchema(document: unknown): JsonSchemaDocument {
  if (!isPlainObject(document) || document["type"] !== "object") {
    return OPAQUE_TOOL_INPUT_SCHEMA;
  }

  const stripped = strip(document, 0);
  if (stripped === undefined) {
    return OPAQUE_TOOL_INPUT_SCHEMA;
  }

  const serialized = JSON.stringify(stripped);
  if (
    serialized === undefined ||
    new TextEncoder().encode(serialized).length > MAX_SERIALIZED_BYTES
  ) {
    return OPAQUE_TOOL_INPUT_SCHEMA;
  }

  return stripped as JsonSchemaDocument;
}
