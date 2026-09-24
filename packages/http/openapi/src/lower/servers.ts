import type { DiagnosticSink } from "../diagnostics.js";
import { childPointer, type JsonPointer } from "../ir/brand.js";
import { arrayOf, objectOf, stringOf, type JsonValue } from "../ir/json.js";

export interface ServerOptions {
  readonly documentUrl?: string;
  readonly baseUrl?: string;
  readonly variables?: Readonly<Record<string, string>>;
}

/**
 * Resolves the first server of the nearest non-empty list among operation and path item, else the
 * root's. A configured `baseUrl` replaces the root list; it does not override a server an
 * operation or path item declares for itself.
 *
 * @param lists the operation's and the path item's lists, nearest first
 */
export function serverOf(
  lists: ReadonlyArray<{
    readonly servers: JsonValue | undefined;
    readonly at: JsonPointer;
  }>,
  root: { readonly servers: JsonValue | undefined; readonly at: JsonPointer },
  options: ServerOptions,
  diagnostics: DiagnosticSink,
): string | undefined {
  const own = lists.find((list) => arrayOf(list.servers).length > 0);
  if (own === undefined && options.baseUrl !== undefined) {
    return stripTrailingSlash(options.baseUrl);
  }
  const chosen = own ?? (arrayOf(root.servers).length > 0 ? root : undefined);
  if (chosen === undefined) {
    return resolve("/", undefined, options, diagnostics);
  }
  const at = childPointer(chosen.at, 0);
  const server = objectOf(arrayOf(chosen.servers)[0]);
  const template = stringOf(server?.["url"]) ?? "/";
  const url = template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    const variable = objectOf(objectOf(server?.["variables"])?.[name]);
    const value = options.variables?.[name] ?? stringOf(variable?.["default"]);
    const allowed = arrayOf(variable?.["enum"])
      .map(stringOf)
      .filter((item): item is string => item !== undefined);
    if (value === undefined) {
      diagnostics.report(
        "server_variable_invalid",
        childPointer(at, "variables", name),
        `Server variable '${name}' has no default and no configured value.`,
      );
      return "";
    }
    if (allowed.length > 0 && !allowed.includes(value)) {
      diagnostics.report(
        "server_variable_invalid",
        childPointer(at, "variables", name),
        `Server variable '${name}' is '${value}', which its enum does not list.`,
      );
    }
    return value;
  });
  return resolve(url, at, options, diagnostics);
}

function resolve(
  url: string,
  at: JsonPointer | undefined,
  options: ServerOptions,
  diagnostics: DiagnosticSink,
): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    return stripTrailingSlash(url);
  }
  if (
    options.documentUrl !== undefined &&
    /^https?:/i.test(options.documentUrl)
  ) {
    return stripTrailingSlash(new URL(url, options.documentUrl).toString());
  }
  diagnostics.report(
    "server_url_unresolvable",
    at ?? ("" as JsonPointer),
    `Server URL '${url}' is relative and the document was not read from a URL; configure a base URL.`,
  );
  return undefined;
}

const stripTrailingSlash = (url: string): string => url.replace(/\/+$/, "");
