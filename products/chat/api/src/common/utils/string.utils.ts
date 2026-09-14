export function normalizeBoundedString(
  value: string | undefined,
  maxLength: number,
  normalize: (raw: string) => string,
): string | undefined {
  if (value === undefined || value.length > maxLength) {
    return undefined;
  }
  const result = normalize(value);

  return result.length === 0 ? undefined : result;
}
