export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function errorName(cause: unknown): string {
  return cause instanceof Error ? cause.name : "UnknownError";
}
