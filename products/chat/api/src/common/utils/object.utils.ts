export type UnknownRecord = Record<PropertyKey, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

export function property(value: unknown, key: PropertyKey): unknown {
  return isRecord(value) ? value[key] : undefined;
}

export function stringProperty(
  value: unknown,
  key: PropertyKey,
): string | undefined {
  const candidate = property(value, key);

  return typeof candidate === "string" ? candidate : undefined;
}
