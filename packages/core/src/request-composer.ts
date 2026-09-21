import { SkMcpArgumentError } from "./errors.js";
import type { ArgumentFill } from "./generated/endpoint-descriptor.js";
import type { ParameterBinding, RequestTemplate } from "./request-template.js";
import {
  allowedArgumentNames,
  deniedArgumentNames,
} from "./request-template.js";

export type BodyValue =
  Record<string, unknown> | readonly unknown[] | string | number | boolean;

export interface ComposedRequest {
  readonly pathAndQuery: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyJson?: BodyValue;
}

/**
 * Composes an HTTP request from flat agent arguments.
 *
 * @param deferred resolved values keyed by source name. The composer never
 * invokes a provider: the SDK resolves every source once per invocation and
 * hands the same map to every composition of that invocation, so a source that
 * is not constant cannot make validation and dispatch disagree.
 */
export function compose(
  template: RequestTemplate,
  args: unknown,
  deferred?: Readonly<Record<string, unknown>>,
): ComposedRequest {
  const entries = toArgumentMap(args);
  rejectUnknown(template, entries);
  const wire = translate(template, entries);
  applyFills(template, wire, deferred);

  let path = template.routeTemplate;
  for (const p of template.parameters.filter((x) => x.location === "path")) {
    const value = wire.get(p.name);
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
    if (!wire.has(p.name)) {
      continue;
    }
    const value = wire.get(p.name);
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
      if (value.length === 0) {
        continue;
      }
      const items = value.map((item) =>
        percentEncode(formatScalar(item, p, "invalid_type")),
      );
      if (p.arraySeparator === undefined) {
        for (const item of items) {
          query.push(`${percentEncode(p.name)}=${item}`);
        }
      } else {
        query.push(
          `${percentEncode(p.name)}=${items.join(separatorFor(p.arraySeparator))}`,
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
    if (!wire.has(p.name)) {
      continue;
    }
    const value = wire.get(p.name);
    if (value === null) {
      throw new SkMcpArgumentError(
        "null_not_allowed",
        `Header argument '${p.name}' cannot be null; omit it instead.`,
      );
    }
    let formatted: string;
    if (p.isArray) {
      if (!Array.isArray(value)) {
        throw new SkMcpArgumentError(
          "invalid_type",
          `Header argument '${p.name}' must be an array.`,
        );
      }
      if (value.length === 0) {
        continue;
      }
      formatted = value
        .map((item) => formatScalar(item, p, "invalid_type"))
        .join(p.arraySeparator ?? ",");
    } else {
      formatted = formatScalar(value, p, "invalid_type");
    }
    if (/[\r\n\0]/.test(formatted)) {
      throw new SkMcpArgumentError(
        "header_injection",
        `Header argument '${p.name}' contains a control character.`,
      );
    }
    headers[p.name] = formatted;
  }

  let bodyJson: BodyValue | undefined;
  if (template.bodyRoot !== undefined) {
    const filled =
      template.rootFill === undefined
        ? absent
        : resolveFill(
            template.rootFill,
            template.bodyRoot,
            template.requiredFills?.has(template.bodyRoot) === true,
            deferred,
            true,
          );
    if (filled !== absent) {
      bodyJson = filled as BodyValue;
    } else if (template.rootFill === undefined && wire.has(template.bodyRoot)) {
      bodyJson = wire.get(template.bodyRoot) as BodyValue;
    }
  } else if (template.hasBody) {
    const fields: Record<string, unknown> = {};
    for (const [name, value] of wire) {
      const isParameter = template.parameters.some((x) => x.name === name);
      if (
        !isParameter &&
        (template.bodyProperties.has(name) ||
          template.bodyAllowsAdditionalProperties)
      ) {
        fields[name] = value;
      }
    }
    bodyJson = fields;
  }

  const pathAndQuery = query.length > 0 ? `${path}?${query.join("&")}` : path;
  return bodyJson === undefined
    ? { pathAndQuery, headers }
    : { pathAndQuery, headers, bodyJson };
}

const absent = Symbol("absent");

/**
 * Rewrites agent keys to wire names.
 *
 * Its own step on purpose: {@link rejectUnknown} runs on the agent namespace
 * and every loop below runs on the wire namespace. Keys the template never
 * declared keep their name, which is correct — a free-form body's extra keys
 * are undeclared and therefore uncurated.
 */
function translate(
  template: RequestTemplate,
  entries: ReadonlyMap<string, unknown>,
): Map<string, unknown> {
  const agentToWire = new Map<string, string>();
  for (const p of template.parameters) {
    if (p.argument !== undefined) {
      agentToWire.set(p.argument, p.name);
    }
  }
  for (const [agentKey, wireField] of template.bodyAliases ?? []) {
    agentToWire.set(agentKey, wireField);
  }
  const wire = new Map<string, unknown>();
  for (const [key, value] of entries) {
    wire.set(agentToWire.get(key) ?? key, value);
  }
  return wire;
}

function resolveFill(
  fill: ArgumentFill,
  wireName: string,
  required: boolean,
  deferred: Readonly<Record<string, unknown>> | undefined,
  isBodySlot: boolean,
): unknown {
  if (fill.kind === "omit") {
    return absent;
  }
  if (fill.kind === "constant") {
    return fill.value;
  }
  const source = fill.source as string;
  const present = deferred !== undefined && Object.hasOwn(deferred, source);
  const value = present ? deferred[source] : undefined;
  /**
   * `null` is not a value on a path, query or header slot: `null_not_allowed`
   * tells the agent to omit the argument instead, and here there is no agent to
   * tell. On a body slot it is written verbatim, because `{"x": null}` is a
   * legitimate body.
   */
  const missing = !present || (value === null && !isBodySlot);
  if (missing) {
    if (required) {
      throw new SkMcpArgumentError(
        "deferred_value_missing",
        `The operation could not be completed because a value it fills itself was unavailable. Retrying with the same arguments will not help. Argument: '${wireName}'.`,
      );
    }
    return absent;
  }
  return value;
}

function assertFilledParameter(value: unknown, p: ParameterBinding): void {
  const items = p.isArray === true ? value : [value];
  const shapeOk = p.isArray !== true || Array.isArray(value);
  const scalarsOk =
    shapeOk &&
    (items as unknown[]).every((item) => {
      switch (p.kind) {
        case "integer":
          return typeof item === "number" && Number.isSafeInteger(item);
        case "number":
          return typeof item === "number" && Number.isFinite(item);
        case "boolean":
          return typeof item === "boolean";
        default:
          return typeof item === "string";
      }
    });
  const clean =
    p.location !== "header" ||
    !(items as unknown[]).some(
      (item) => typeof item === "string" && /[\r\n\0]/.test(item),
    );
  if (!shapeOk || !scalarsOk || !clean) {
    throw new SkMcpArgumentError(
      "deferred_value_invalid",
      `The operation could not be completed because a value it fills itself was unusable. Retrying with the same arguments will not help. Argument: '${p.name}'.`,
    );
  }
}

function applyFills(
  template: RequestTemplate,
  wire: Map<string, unknown>,
  deferred: Readonly<Record<string, unknown>> | undefined,
): void {
  for (const p of template.parameters) {
    if (p.fill === undefined) {
      continue;
    }
    const required =
      p.location === "path" || template.requiredFills?.has(p.name) === true;
    const value = resolveFill(p.fill, p.name, required, deferred, false);
    if (value === absent) {
      continue;
    }
    assertFilledParameter(value, p);
    wire.set(p.name, value);
  }
  for (const [field, fill] of template.bodyFills ?? []) {
    const value = resolveFill(
      fill,
      field,
      template.requiredFills?.has(field) === true,
      deferred,
      true,
    );
    if (value !== absent) {
      wire.set(field, value);
    }
  }
}

function describeArgumentKind(args: unknown): string {
  if (args === null) {
    return "null";
  }
  if (Array.isArray(args)) {
    return "an array";
  }
  switch (typeof args) {
    case "string":
      return "a string";
    case "number":
      return "a number";
    case "boolean":
      return "a boolean";
    default:
      return "a value that is not an object";
  }
}

function toArgumentMap(args: unknown): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (args === undefined) {
    return map;
  }
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new SkMcpArgumentError(
      "invalid_type",
      `Arguments must be a JSON object; received ${describeArgumentKind(args)}. Send each argument as a property of that object and call the operation again.`,
    );
  }
  for (const [name, value] of Object.entries(args)) {
    if (value !== undefined) {
      map.set(name, value);
    }
  }
  return map;
}

/**
 * The deny-list beats the free-form allowance, and the message never names a
 * denied argument.
 *
 * Both halves are load-bearing. Without the precedence, an open body accepts a
 * hidden field's wire name and the hide is bypassed; without the silence, the
 * error distinguishes "no such argument" from "that argument is not yours to
 * set" and becomes an existence oracle for hidden arguments.
 */
function rejectUnknown(
  template: RequestTemplate,
  entries: Map<string, unknown>,
): void {
  const allowedNames = allowedArgumentNames(template);
  const deniedNames = deniedArgumentNames(template);
  const unknown: string[] = [];
  for (const name of entries.keys()) {
    const known =
      !deniedNames.has(name) &&
      (allowedNames.has(name) ||
        (template.hasBody && template.bodyAllowsAdditionalProperties));
    if (!known) {
      unknown.push(name);
    }
  }
  if (unknown.length > 0) {
    const allowed = [...allowedNames].sort();
    throw new SkMcpArgumentError(
      "unknown_argument",
      `Unknown argument(s): ${unknown.join(", ")}. Allowed: ${allowed.join(", ")}.`,
    );
  }
}

/**
 * Renders a delimiter for the query string. The caller appends the result raw,
 * never through {@link percentEncode}: the two languages' encoders disagree on
 * `,` (`encodeURIComponent` leaves it, `Uri.EscapeDataString` escapes it to
 * `%2C`), so encoding the delimiter would make the two SDKs emit different byte
 * strings for the same input. A literal space is illegal in a URL, hence `%20`.
 */
function separatorFor(delimiter: string): string {
  return delimiter === " " ? "%20" : delimiter;
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
