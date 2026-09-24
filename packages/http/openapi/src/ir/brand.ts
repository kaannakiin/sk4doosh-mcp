declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** An RFC 6901 pointer into the document as the author wrote it. */
export type JsonPointer = Brand<string, "JsonPointer">;

export type HttpMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS"
  | "QUERY"
  | "TRACE";

export type OperationKey = Brand<`${HttpMethod} ${string}`, "OperationKey">;

export const rootPointer = "" as JsonPointer;

const escapeSegment = (segment: string | number): string =>
  String(segment).replaceAll("~", "~0").replaceAll("/", "~1");

export function childPointer(
  parent: JsonPointer,
  ...segments: readonly (string | number)[]
): JsonPointer {
  return `${parent}${segments.map((segment) => `/${escapeSegment(segment)}`).join("")}` as JsonPointer;
}

export function segmentsOf(pointer: string): string[] {
  if (pointer === "" || pointer === "#") {
    return [];
  }
  const body = pointer.startsWith("#") ? pointer.slice(1) : pointer;
  return body
    .split("/")
    .slice(1)
    .map((segment) =>
      decodeURIComponent(segment).replaceAll("~1", "/").replaceAll("~0", "~"),
    );
}

export function operationKey(method: HttpMethod, path: string): OperationKey {
  return `${method} ${path}` as OperationKey;
}
