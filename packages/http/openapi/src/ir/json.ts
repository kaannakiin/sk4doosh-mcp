export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | JsonObject;

export interface JsonObject {
  readonly [key: string]: JsonValue | undefined;
}

export type MutableJsonObject = { [key: string]: JsonValue | undefined };

export const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const objectOf = (value: unknown): JsonObject | undefined =>
  isObject(value) ? value : undefined;

export const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

export const booleanOf = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

export const arrayOf = (value: unknown): readonly JsonValue[] =>
  Array.isArray(value) ? (value as readonly JsonValue[]) : [];

export function entriesOf(
  value: unknown,
): ReadonlyArray<readonly [string, JsonValue]> {
  if (!isObject(value)) {
    return [];
  }
  return Object.entries(value).filter(
    (entry): entry is [string, JsonValue] => entry[1] !== undefined,
  );
}

export function clone<T extends JsonValue>(value: T): T {
  return structuredClone(value);
}
