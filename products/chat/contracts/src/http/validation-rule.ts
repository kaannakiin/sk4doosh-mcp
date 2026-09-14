import type { $ZodIssue } from "zod/v4/core";

/**
 * Guard: one implementation for both sides of the wire. The browser validates
 * with these schemas and the api re-validates with the same ones, so a rule kept
 * in two places lets the same rejected field read one way in the form and
 * another in the response — the drift is invisible until someone bypasses the
 * form.
 *
 * Returns a message key, never prose: this package stays locale-free.
 */
export function validationRuleOf(issue: $ZodIssue, blank: boolean): string {
  if (blank) {
    return "required";
  }
  if (issue.code === "too_small") {
    return "too_small";
  }
  if (issue.code === "too_big") {
    return "too_big";
  }
  if (issue.code === "invalid_format" && issue.format === "email") {
    return "email";
  }
  if (issue.code === "invalid_format" && issue.format === "e164") {
    return "phone";
  }

  return "fallback";
}

/**
 * Guard: whitespace counts as empty, because these fields are built from
 * `.trim().min(1)` — a name of three spaces fails the same check a name of none
 * does, and reads the same way to whoever typed it.
 */
export function isBlankAt(input: unknown, path: $ZodIssue["path"]): boolean {
  let cursor: unknown = input;
  for (const segment of path) {
    if (typeof cursor !== "object" || cursor === null) {
      return false;
    }
    cursor = (cursor as Record<string, unknown>)[String(segment)];
  }

  return (
    cursor === undefined ||
    cursor === null ||
    (typeof cursor === "string" && cursor.trim().length === 0)
  );
}

export function validationLimitOf(issue: $ZodIssue): number | undefined {
  if ("minimum" in issue) {
    return Number(issue.minimum);
  }

  return "maximum" in issue ? Number(issue.maximum) : undefined;
}
