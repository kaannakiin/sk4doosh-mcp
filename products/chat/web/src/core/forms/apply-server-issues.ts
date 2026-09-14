import { isChatClientError } from "@chat/queries/client";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

/**
 * Moves an api rejection onto the form that caused it.
 *
 * Guard: `issue.path` is the raw zod path and react-hook-form addresses nested
 * fields with the same dotted notation, so `["address","city"]` maps straight
 * onto `"address.city"` with no translation table. An empty path is a
 * whole-body issue and belongs on `root`, not on an invented field.
 *
 * Guard: `issue.message` is rendered as the api wrote it. The pipe already
 * localized it through `x-locale`, field label included, so re-translating here
 * would be a second source of truth that drifts from the server's within a
 * release.
 *
 * @param fieldForCode pins a whole-request error code to the field it is about
 * @returns `"fields"` when the message landed on inputs, `"form"` when it did not
 */
export function applyServerIssues<TValues extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<TValues>,
  fieldForCode: Readonly<Partial<Record<string, Path<TValues>>>> = {},
): "fields" | "form" {
  if (!isChatClientError(error)) {
    return "form";
  }

  const { code, message, issues } = error.payload;

  if (issues !== undefined && issues.length > 0) {
    let focused = false;
    for (const issue of issues) {
      const name = (
        issue.path.length === 0 ? "root" : issue.path.join(".")
      ) as Path<TValues>;
      setError(
        name,
        { type: issue.code, message: issue.message },
        { shouldFocus: !focused },
      );
      focused = true;
    }

    return "fields";
  }

  const field = fieldForCode[code];
  if (field === undefined) {
    return "form";
  }
  setError(field, { type: code, message }, { shouldFocus: true });

  return "fields";
}
