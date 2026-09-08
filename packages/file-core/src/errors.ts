import type { Vocabulary } from "./vocabulary.js";
import { asciiLower } from "./unicode.js";

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
  | "file_changed"
  | "unsupported_platform"
  | "resource_limit"
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
  const base = root?.replaceAll("\\", "/").replace(/\/$/, "");
  const sanitize = (path: string): string => {
    const normalized = path.replaceAll("\\", "/");
    const compare = /^[A-Za-z]:/.test(normalized)
      ? asciiLower(normalized)
      : normalized;
    const rootKey =
      base !== undefined && /^[A-Za-z]:/.test(base) ? asciiLower(base) : base;
    if (rootKey !== undefined && compare === rootKey) return ".";
    if (rootKey !== undefined && compare.startsWith(`${rootKey}/`))
      return normalized.slice(rootKey.length + 1);
    return "[path]";
  };
  const quoted = detail.replace(
    /(['"])((?:[A-Za-z]:[\\/]|\\\\|\/)[^'"]*)\1/g,
    (_match: string, quote: string, path: string) =>
      quote + sanitize(path) + quote,
  );
  return quoted.replace(
    /(^|[\s'"(])((?:[A-Za-z]:[\\/]|\\\\|\/)[^\s'"()<>]*)/g,
    (_match: string, prefix: string, path: string) => prefix + sanitize(path),
  );
}

export function internalErrorMessage(
  _error: unknown,
  context: ErrorContext,
): string {
  const subject = context.tool ?? "The tool";
  return `${subject} failed unexpectedly.`;
}

export function internalErrorRecovery(vocabulary: Vocabulary<string>): string {
  return `This is a fault in the ${vocabulary.serverName} server, not in the ${vocabulary.subject}. Retrying the same call will not help.`;
}
