import { sep } from "node:path";
import type { Vocabulary } from "./vocabulary.js";

export type CoreErrorCode =
  | "invalid_argument"
  | "path_outside_root"
  | "unsupported_extension"
  | "file_not_found"
  | "not_a_file"
  | "file_too_large"
  | "unsupported_for_format"
  | "invalid_cursor"
  | "stale_cursor"
  | "internal_error";

export class FileSourceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recovery?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export type ErrorFactory<TCode extends string> = (
  code: TCode,
  message: string,
  recovery?: string,
) => FileSourceError;

export interface ErrorContext {
  readonly root?: string;
  readonly tool?: string;
}

export function redactRoot(detail: string, root: string | undefined): string {
  if (root === undefined || root === "") {
    return detail;
  }
  return detail.split(`${root}${sep}`).join("").split(root).join(".");
}

export function internalErrorMessage(
  error: unknown,
  context: ErrorContext,
): string {
  const detail = error instanceof Error ? error.message : String(error);
  const subject = context.tool ?? "The tool";
  return `${subject} failed unexpectedly: ${redactRoot(detail, context.root)}`;
}

export function internalErrorRecovery(vocabulary: Vocabulary<string>): string {
  return `This is a fault in the ${vocabulary.serverName} server, not in the ${vocabulary.subject}. Retrying the same call will not help.`;
}
