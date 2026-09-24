import { SkMcpArgumentError } from "./errors.js";
import { encodeBody } from "./request-body.js";
import type { BodyValue, ComposeLimits, ComposedBody } from "./request-body.js";
import type { ArgumentFill } from "./generated/endpoint-descriptor.js";
import type {
  ContentParameterBinding,
  ObjectParameterBinding,
  RequestTemplate,
  ScalarParameterBinding,
} from "./request-template.js";
import {
  formatScalar,
  memberKey,
  percentEncode,
  percentEncodeAllowingReserved,
  separatorFor,
} from "./wire-encoding.js";
import {
  allowedArgumentNames,
  deniedArgumentNames,
  isCookieOctets,
} from "./request-template.js";

export interface ComposedRequest {
  readonly pathAndQuery: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: ComposedBody;
}

/**
 * Composes an HTTP request from flat agent arguments.
 *
 * @param deferred resolved values keyed by source name. The composer never
 * invokes a provider: the SDK resolves every source once per invocation and
 * hands the same map to every composition of that invocation, so a source that
 * is not constant cannot make validation and dispatch disagree.
 * @param limits the invoke budgets the composer enforces itself.
 */
export function compose(
  template: RequestTemplate,
  args: unknown,
  deferred?: Readonly<Record<string, unknown>>,
  limits?: ComposeLimits,
): ComposedRequest {
  const entries = toArgumentMap(args);
  rejectUnknown(template, entries);
  rejectUnknownMembers(template, entries);
  const wire = translate(template, entries);
  applyFills(template, wire, deferred);

  let path = template.routeTemplate;
  for (const p of template.parameters.filter(
    (x): x is ScalarParameterBinding | ContentParameterBinding =>
      x.location === "path" && x.kind !== "object",
  )) {
    const value = wire.get(p.name);
    if (value === undefined || value === null) {
      throw new SkMcpArgumentError(
        "missing_path_parameter",
        `Missing required path argument '${p.name}'.`,
      );
    }
    path = path.replaceAll(
      `{${p.name}}`,
      p.kind === "content"
        ? percentEncode(contentText(p, value))
        : pathSegment(p, value),
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
    if (p.kind === "object") {
      query.push(...objectQueryEntries(p, value));
      continue;
    }
    if (p.kind === "content") {
      query.push(
        `${percentEncode(p.name)}=${percentEncode(contentText(p, value))}`,
      );
      continue;
    }
    const encodeValue =
      p.allowReserved === true ? percentEncodeAllowingReserved : percentEncode;
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
      /**
       * Guard: `allowReserved` must not write an element's own delimiter raw, or `["c,d"]` would
       * come back as two elements; every other reserved character stays raw.
       */
      const separator = p.arraySeparator;
      const items = value.map((item) => {
        const encoded = encodeValue(formatScalar(item, p, "invalid_type"));
        return p.allowReserved === true && separator === ","
          ? encoded.replaceAll(",", "%2C")
          : encoded;
      });
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
        `${percentEncode(p.name)}=${encodeValue(formatScalar(value, p, "invalid_type"))}`,
      );
    }
  }

  const querystring = template.parameters.find(
    (x): x is ContentParameterBinding =>
      x.location === "querystring" && x.kind === "content",
  );
  let queryText = query.join("&");
  if (querystring !== undefined && wire.has(querystring.name)) {
    queryText = querystringText(querystring, wire.get(querystring.name));
  }

  const headers: Record<string, string> = {};
  for (const p of template.parameters.filter(
    (x): x is ScalarParameterBinding | ContentParameterBinding =>
      x.location === "header" && x.kind !== "object",
  )) {
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
    if (p.kind === "content") {
      formatted = contentText(p, value);
    } else if (p.isArray) {
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

  const cookies: string[] = [];
  for (const p of template.parameters.filter(
    (x): x is ScalarParameterBinding | ContentParameterBinding =>
      x.location === "cookie" && x.kind !== "object",
  )) {
    if (!wire.has(p.name)) {
      continue;
    }
    const value = wire.get(p.name);
    if (value === null) {
      throw new SkMcpArgumentError(
        "null_not_allowed",
        `Cookie argument '${p.name}' cannot be null; omit it instead.`,
      );
    }
    if (p.kind === "content") {
      cookies.push(`${p.name}=${percentEncode(contentText(p, value))}`);
      continue;
    }
    if (p.isArray) {
      if (!Array.isArray(value)) {
        throw new SkMcpArgumentError(
          "invalid_type",
          `Cookie argument '${p.name}' must be an array.`,
        );
      }
      if (value.length === 0) {
        continue;
      }
      cookies.push(
        `${p.name}=${value.map((item) => cookieValue(item, p)).join(p.arraySeparator ?? ",")}`,
      );
    } else {
      cookies.push(`${p.name}=${cookieValue(value, p)}`);
    }
  }
  if (cookies.length > 0) {
    headers["cookie"] = cookies.join("; ");
  }

  let bodyValue: BodyValue | undefined;
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
      bodyValue = filled as BodyValue;
    } else if (template.rootFill === undefined && wire.has(template.bodyRoot)) {
      bodyValue = wire.get(template.bodyRoot) as BodyValue;
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
    bodyValue = fields;
  }

  const pathAndQuery = queryText.length > 0 ? `${path}?${queryText}` : path;
  const body = encodeBody(template, bodyValue, limits);
  return body === undefined
    ? { pathAndQuery, headers }
    : { pathAndQuery, headers, body };
}

const absent = Symbol("absent");

function contentText(p: ContentParameterBinding, value: unknown): string {
  if (p.mediaType === "text/plain") {
    if (typeof value !== "string") {
      throw new SkMcpArgumentError(
        "invalid_type",
        `Argument '${p.name}' must be of type string.`,
      );
    }
    return value;
  }
  return JSON.stringify(value);
}

/**
 * A querystring parameter is the whole query string: JSON is percent-encoded as one value, and
 * urlencoded content writes one pair per declared member in declaration order, repeating the key
 * for an array member.
 */
function querystringText(p: ContentParameterBinding, value: unknown): string {
  if (value === null) {
    throw new SkMcpArgumentError(
      "null_not_allowed",
      `Query argument '${p.name}' cannot be null; omit it instead.`,
    );
  }
  if (p.mediaType !== "application/x-www-form-urlencoded") {
    return percentEncode(contentText(p, value));
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new SkMcpArgumentError(
      "invalid_type",
      `Query argument '${p.name}' must be an object.`,
    );
  }
  const supplied = value as Readonly<Record<string, unknown>>;
  return (p.members ?? [])
    .flatMap((member) => {
      const item = supplied[member.name];
      if (item === undefined) {
        return [];
      }
      const slot = { name: `${p.name}.${member.name}`, kind: member.kind };
      if (item === null) {
        throw new SkMcpArgumentError(
          "null_not_allowed",
          `Query argument '${slot.name}' cannot be null; omit it instead.`,
        );
      }
      const key = percentEncode(member.name);
      if (member.isArray !== true) {
        return [
          `${key}=${percentEncode(formatScalar(item, slot, "invalid_type"))}`,
        ];
      }
      if (!Array.isArray(item)) {
        throw new SkMcpArgumentError(
          "invalid_type",
          `Query argument '${slot.name}' must be an array.`,
        );
      }
      return item.map(
        (element) =>
          `${key}=${percentEncode(formatScalar(element, slot, "invalid_type"))}`,
      );
    })
    .join("&");
}

/**
 * Guard: each element is encoded on its own and the style's delimiters are written raw, the rule
 * the query delimiter already follows, so an element containing `,` or `.` stays one element and
 * `5/../admin` stays one segment.
 */
function pathSegment(p: ScalarParameterBinding, value: unknown): string {
  const key = percentEncode(p.name);
  if (p.isArray !== true) {
    const item = percentEncode(formatScalar(value, p, "invalid_path_type"));
    switch (p.pathStyle) {
      case "label":
        return `.${item}`;
      case "matrix":
        return `;${key}=${item}`;
      default:
        return item;
    }
  }
  if (!Array.isArray(value)) {
    throw new SkMcpArgumentError(
      "invalid_path_type",
      `Path argument '${p.name}' must be an array.`,
    );
  }
  if (value.length === 0) {
    throw new SkMcpArgumentError(
      "missing_path_parameter",
      `Missing required path argument '${p.name}'; an empty array fills no segment.`,
    );
  }
  const items = value.map((item) =>
    percentEncode(formatScalar(item, p, "invalid_path_type")),
  );
  switch (p.pathStyle) {
    case "label":
      return `.${items.join(p.explode === true ? "." : ",")}`;
    case "matrix":
      return p.explode === true
        ? items.map((item) => `;${key}=${item}`).join("")
        : `;${key}=${items.join(",")}`;
    default:
      return items.join(",");
  }
}

function cookieValue(value: unknown, p: ScalarParameterBinding): string {
  const formatted = formatScalar(value, p, "invalid_type");
  if (p.rawCookie !== true) {
    return percentEncode(formatted);
  }
  if (!isCookieOctets(formatted)) {
    throw new SkMcpArgumentError(
      "invalid_cookie_value",
      `Cookie argument '${p.name}' contains a character a cookie value cannot carry; space, '"', ',', ';', '\\' and control characters are not allowed.`,
    );
  }
  return formatted;
}

/**
 * Joins the cookies an identity carrier already put on the request with the composed ones.
 *
 * @throws SkMcpArgumentError `cookie_carrier_collision` when a composed cookie has the name of a
 * carried one: either side winning would be a silent resolution — the agent overwriting the
 * caller's credential, or the agent's value vanishing without an error.
 */
export function mergeCookieHeader(
  carried: string | undefined,
  composed: string | undefined,
): string | undefined {
  if (composed === undefined) {
    return carried;
  }
  if (carried === undefined || carried.trim() === "") {
    return composed;
  }
  const names = new Set(cookieNames(carried));
  const clash = cookieNames(composed).find((name) => names.has(name));
  if (clash !== undefined) {
    throw new SkMcpArgumentError(
      "cookie_carrier_collision",
      `Cookie '${clash}' already travels with the caller's identity and cannot also be sent as an argument; omit it.`,
    );
  }
  return `${carried}; ${composed}`;
}

function cookieNames(header: string): string[] {
  return header
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair.length > 0)
    .map((pair) => (pair.split("=", 1)[0] ?? "").trim());
}

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

function assertFilledParameter(
  value: unknown,
  p: ScalarParameterBinding,
): void {
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
    (p.location !== "header" ||
      !(items as unknown[]).some(
        (item) => typeof item === "string" && /[\r\n\0]/.test(item),
      )) &&
    (p.rawCookie !== true ||
      (items as unknown[]).every(
        (item) => typeof item !== "string" || isCookieOctets(item),
      ));
  if (!shapeOk || !scalarsOk || !clean) {
    throw new SkMcpArgumentError(
      "deferred_value_invalid",
      `The operation could not be completed because a value it fills itself was unusable. Retrying with the same arguments will not help. Argument: '${p.name}'.`,
    );
  }
}

function assertFilledContent(value: unknown, p: ContentParameterBinding): void {
  const text = p.mediaType === "text/plain";
  const serialized = text ? value : JSON.stringify(value);
  const unusable =
    typeof serialized !== "string" ||
    (p.location === "header" && /[\r\n\0]/.test(serialized));
  if (unusable) {
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
    if (p.fill === undefined || p.kind === "object") {
      continue;
    }
    const required =
      p.location === "path" || template.requiredFills?.has(p.name) === true;
    const value = resolveFill(p.fill, p.name, required, deferred, false);
    if (value === absent) {
      continue;
    }
    if (p.kind === "content") {
      assertFilledContent(value, p);
    } else {
      assertFilledParameter(value, p);
    }
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
 * Guard: a member the template never declared would be dropped in silence,
 * which is the failure {@link rejectUnknown} exists to prevent one level up.
 * It runs in the agent namespace, before {@link translate}, for the same
 * reason that one does.
 */
function rejectUnknownMembers(
  template: RequestTemplate,
  entries: ReadonlyMap<string, unknown>,
): void {
  for (const parameter of template.parameters) {
    if (
      parameter.kind !== "object" &&
      (parameter.kind !== "content" || parameter.members === undefined)
    ) {
      continue;
    }
    const group = parameter.argument ?? parameter.name;
    const value = entries.get(group);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    const members = parameter.members ?? [];
    const declared = new Set(members.map((member) => member.name));
    const unknown = Object.keys(value).filter((name) => !declared.has(name));
    if (unknown.length > 0) {
      const allowed = members.map((member) => `${group}.${member.name}`).sort();
      throw new SkMcpArgumentError(
        "unknown_argument",
        `Unknown argument(s): ${unknown.map((name) => `${group}.${name}`).join(", ")}. Allowed: ${allowed.join(", ")}.`,
      );
    }
  }
}

function objectQueryEntries(
  parameter: ObjectParameterBinding,
  value: unknown,
): readonly string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SkMcpArgumentError(
      "invalid_type",
      `Query argument '${parameter.name}' must be an object.`,
    );
  }
  const supplied = value as Readonly<Record<string, unknown>>;
  return parameter.members.flatMap((member) => {
    const item = supplied[member.name];
    if (item === undefined) {
      return [];
    }
    const slot = {
      name: `${parameter.name}.${member.name}`,
      kind: member.kind,
    };
    if (item === null) {
      throw new SkMcpArgumentError(
        "null_not_allowed",
        `Query argument '${slot.name}' cannot be null; omit it instead.`,
      );
    }
    const key = memberKey(
      parameter.name,
      member.name,
      parameter.notation,
      percentEncode,
    );
    if (member.isArray !== true) {
      return [
        `${key}=${percentEncode(formatScalar(item, slot, "invalid_type"))}`,
      ];
    }
    if (!Array.isArray(item)) {
      throw new SkMcpArgumentError(
        "invalid_type",
        `Query argument '${slot.name}' must be an array.`,
      );
    }
    return item.map(
      (element) =>
        `${key}=${percentEncode(formatScalar(element, slot, "invalid_type"))}`,
    );
  });
}
