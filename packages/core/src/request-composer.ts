import { SkMcpArgumentError } from "./errors.js";
import type { ParameterBinding, RequestTemplate } from "./request-template.js";

export interface ComposedRequest {
  readonly pathAndQuery: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyJson?: Record<string, unknown>;
}

export function compose(
  template: RequestTemplate,
  args: unknown,
): ComposedRequest {
  const entries = toArgumentMap(args);
  rejectUnknown(template, entries);

  let path = template.routeTemplate;
  for (const p of template.parameters.filter((x) => x.location === "path")) {
    const value = entries.get(p.name);
    if (value === undefined || value === null) {
      throw new SkMcpArgumentError(
        "missing_path_parameter",
        `Missing required path argument '${p.name}'.`,
      );
    }
    path = path.replaceAll(
      `{${p.name}}`,
      percentEncode(formatScalar(value, p, "invalid_path_type")),
    );
  }

  const query: string[] = [];
  for (const p of template.parameters.filter((x) => x.location === "query")) {
    if (!entries.has(p.name)) {
      continue;
    }
    const value = entries.get(p.name);
    if (value === null) {
      throw new SkMcpArgumentError(
        "null_not_allowed",
        `Query argument '${p.name}' cannot be null; omit it instead.`,
      );
    }
    if (p.isArray) {
      if (!Array.isArray(value)) {
        throw new SkMcpArgumentError(
          "invalid_type",
          `Query argument '${p.name}' must be an array.`,
        );
      }
      for (const item of value) {
        query.push(
          `${percentEncode(p.name)}=${percentEncode(formatScalar(item, p, "invalid_type"))}`,
        );
      }
    } else {
      query.push(
        `${percentEncode(p.name)}=${percentEncode(formatScalar(value, p, "invalid_type"))}`,
      );
    }
  }

  const headers: Record<string, string> = {};
  for (const p of template.parameters.filter((x) => x.location === "header")) {
    if (!entries.has(p.name)) {
      continue;
    }
    const value = entries.get(p.name);
    if (value === null) {
      throw new SkMcpArgumentError(
        "null_not_allowed",
        `Header argument '${p.name}' cannot be null; omit it instead.`,
      );
    }
    const formatted = formatScalar(value, p, "invalid_type");
    if (/[\r\n\0]/.test(formatted)) {
      throw new SkMcpArgumentError(
        "header_injection",
        `Header argument '${p.name}' contains a control character.`,
      );
    }
    headers[p.name] = formatted;
  }

  let bodyJson: Record<string, unknown> | undefined;
  if (template.hasBody) {
    bodyJson = {};
    for (const [name, value] of entries) {
      const isParameter = template.parameters.some((x) => x.name === name);
      if (
        !isParameter &&
        (template.bodyProperties.has(name) ||
          template.bodyAllowsAdditionalProperties)
      ) {
        bodyJson[name] = value;
      }
    }
  }

  const pathAndQuery = query.length > 0 ? `${path}?${query.join("&")}` : path;
  return bodyJson === undefined
    ? { pathAndQuery, headers }
    : { pathAndQuery, headers, bodyJson };
}

function toArgumentMap(args: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (args === undefined) {
    return map;
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new SkMcpArgumentError(
      "invalid_type",
      "Arguments must be a JSON object.",
    );
  }
  for (const [name, value] of Object.entries(args)) {
    if (value !== undefined) {
      map.set(name, value);
    }
  }
  return map;
}

function rejectUnknown(
  template: RequestTemplate,
  entries: Map<string, unknown>,
): void {
  const unknown: string[] = [];
  for (const name of entries.keys()) {
    const known =
      template.parameters.some((p) => p.name === name) ||
      template.bodyProperties.has(name) ||
      (template.hasBody && template.bodyAllowsAdditionalProperties);
    if (!known) {
      unknown.push(name);
    }
  }
  if (unknown.length > 0) {
    const allowed = [
      ...template.parameters.map((p) => p.name),
      ...template.bodyProperties,
    ].sort();
    throw new SkMcpArgumentError(
      "unknown_argument",
      `Unknown argument(s): ${unknown.join(", ")}. Allowed: ${allowed.join(", ")}.`,
    );
  }
}

function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function formatScalar(
  value: unknown,
  parameter: ParameterBinding,
  errorCode: "invalid_path_type" | "invalid_type",
): string {
  switch (parameter.kind) {
    case "string":
      if (typeof value === "string") {
        return value;
      }
      break;
    case "integer":
      if (typeof value === "number" && Number.isSafeInteger(value)) {
        return String(value);
      }
      break;
    case "number":
      if (typeof value === "number") {
        return String(value);
      }
      break;
    case "boolean":
      if (typeof value === "boolean") {
        return String(value);
      }
      break;
  }
  throw new SkMcpArgumentError(
    errorCode,
    `Argument '${parameter.name}' must be of type ${parameter.kind}.`,
  );
}
