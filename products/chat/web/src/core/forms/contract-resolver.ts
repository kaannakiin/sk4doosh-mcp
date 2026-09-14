import {
  isBlankAt,
  validationLimitOf,
  validationRuleOf,
} from "@chat/contracts/http/validation-rule";
import type { FieldErrors, FieldValues, Resolver } from "react-hook-form";
import type { TFunction } from "i18next";
import type { $ZodIssue } from "zod/v4/core";

/**
 * The parse surface a contract schema exposes, named structurally.
 *
 * Guard: zod is a type-only import here. The chat app is barred from taking a
 * value dependency on it so the two product lines cannot drift onto different
 * majors, and nothing below needs the library itself — only the shape of the
 * issues it reports.
 */
export interface ParsableSchema<TOutput> {
  safeParse: (input: unknown) =>
    | { success: true; data: TOutput }
    | { success: false; error: { issues: readonly $ZodIssue[] } };
}

/**
 * Validates a form against a contract schema, in the reader's language.
 *
 * Guard: zod's own `safeParse`, not `standardSchemaResolver`. A Standard Schema
 * issue carries only `message` and `path`, so the `code`, `minimum` and `format`
 * a localized message is looked up by are gone by the time the resolver sees it
 * — and zod's english default leaks onto the field instead. The api's pipe
 * refuses Standard Schema for exactly this reason.
 */
export function contractResolver<TValues extends FieldValues, TOutput>(
  schema: ParsableSchema<TOutput>,
  t: TFunction,
): Resolver<TValues, unknown, TOutput> {
  return (values) => {
    const result = schema.safeParse(values);
    if (result.success) {
      return { values: result.data, errors: {} };
    }

    const errors: FieldErrors<TValues> = {};
    for (const issue of result.error.issues) {
      place(errors, issue, messageFor(issue, t, isBlankAt(values, issue.path)));
    }

    return { values: {}, errors };
  };
}

/**
 * Guard: the first issue on a field wins. Zod reports every failed check, and
 * overwriting would leave a field showing the least specific of them.
 */
function place(
  errors: Record<string, unknown>,
  issue: $ZodIssue,
  message: string,
): void {
  const path = issue.path.length === 0 ? ["root"] : issue.path;
  let cursor = errors;
  for (const segment of path.slice(0, -1)) {
    const key = String(segment);
    cursor[key] ??= {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  const leaf = String(path.at(-1));
  cursor[leaf] ??= { type: issue.code, message };
}

function messageFor(
  issue: $ZodIssue,
  t: TFunction,
  blank: boolean,
): string {
  const name = issue.path.at(-1);
  const field = t(`validation.fields.${String(name ?? "root")}`, {
    defaultValue: String(name ?? ""),
  });

  return t(`validation.issues.${validationRuleOf(issue, blank)}`, {
    field,
    limit: validationLimitOf(issue),
  });
}
