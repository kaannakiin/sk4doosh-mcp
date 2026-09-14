export function isUniqueConstraintError(
  error: unknown,
): error is { readonly code: "P2002" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
