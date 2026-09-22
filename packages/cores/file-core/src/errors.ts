import {
  McpSourceError,
  asciiLower,
  type ErrorContext as SourceErrorContext,
  type SourceErrorCode,
} from "@sk-mcp/mcp-core";

export type { ErrorFactory } from "@sk-mcp/mcp-core";

export type CoreErrorCode =
  | SourceErrorCode
  | "path_outside_root"
  | "unsupported_extension"
  | "file_not_found"
  | "not_a_file"
  | "file_too_large"
  | "unsupported_for_format"
  | "file_changed"
  | "unsupported_platform";

export class FileSourceError extends McpSourceError {}

export interface ErrorContext extends SourceErrorContext {
  readonly root?: string;
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
