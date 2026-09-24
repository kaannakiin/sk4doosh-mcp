import { OperationDropped } from "../diagnostics.js";
import { segmentsOf, type JsonPointer } from "../ir/brand.js";
import {
  isObject,
  objectOf,
  stringOf,
  type JsonObject,
  type JsonValue,
} from "../ir/json.js";

export function resolvePointer(
  document: JsonObject,
  ref: string,
): JsonValue | undefined {
  let node: JsonValue | undefined = document;
  for (const segment of segmentsOf(ref)) {
    if (Array.isArray(node)) {
      node = (node as readonly JsonValue[])[Number(segment)];
    } else if (isObject(node)) {
      node = node[segment];
    } else {
      return undefined;
    }
  }
  return node;
}

export function pointerOfRef(ref: string): JsonPointer {
  return (ref.startsWith("#") ? ref.slice(1) : ref) as JsonPointer;
}

/**
 * Follows a chain of references to a non-schema component (a parameter, request body, response,
 * header or path item) and returns the object it ends at, with the pointer of that object.
 *
 * @throws OperationDropped `circular_component_ref` when the chain returns to a reference it
 * already followed, or ends nowhere
 */
export function resolveComponent(
  document: JsonObject,
  value: JsonValue | undefined,
  at: JsonPointer,
): { readonly node: JsonObject; readonly at: JsonPointer } | undefined {
  let node = objectOf(value);
  let where = at;
  const seen = new Set<string>();
  while (node !== undefined) {
    const ref = stringOf(node["$ref"]);
    if (ref === undefined) {
      return { node, at: where };
    }
    if (seen.has(ref) || !ref.startsWith("#")) {
      throw new OperationDropped(
        "circular_component_ref",
        where,
        `Reference '${ref}' ${seen.has(ref) ? "returns to itself" : "is not local"}.`,
      );
    }
    seen.add(ref);
    where = pointerOfRef(ref);
    node = objectOf(resolvePointer(document, ref));
    if (node === undefined) {
      throw new OperationDropped(
        "circular_component_ref",
        where,
        `Reference '${ref}' resolves to nothing.`,
      );
    }
  }
  return undefined;
}
