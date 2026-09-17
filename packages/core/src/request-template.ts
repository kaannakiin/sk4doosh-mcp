import { assertUniqueArgumentNames } from "./argument-names.js";
import type { ArgumentFill } from "./generated/endpoint-descriptor.js";
import { SkMcpTemplateError } from "./errors.js";
import type { Parameter } from "./generated/endpoint-descriptor.js";

export type ParameterLocation = "path" | "query" | "header";

export type ParameterKind = "string" | "integer" | "number" | "boolean";

export type ParameterStyle = NonNullable<Parameter["style"]>;

export interface ParameterBinding {
  readonly name: string;
  readonly location: ParameterLocation;
  readonly kind: ParameterKind;
  readonly isArray?: boolean;
  /**
   * The delimiter that joins array items into one value; `undefined` repeats
   * the key instead. Normalised from `style`/`explode` by
   * {@link arraySeparatorFor} so the invalid pairings cannot be represented.
   */
  readonly arraySeparator?: string;
  /**
   * The key the agent sends, when it differs from the wire name. Omitted when
   * they are equal, so two templates describing the same binding stay deeply
   * equal.
   */
  readonly argument?: string;
  /** Present means hidden: the agent cannot send this, the value is written from here. */
  readonly fill?: ArgumentFill;
}

const delimiters: Readonly<Record<ParameterStyle, string>> = {
  form: ",",
  spaceDelimited: " ",
  pipeDelimited: "|",
};

/**
 * Normalises an OpenAPI `style`/`explode` pair into a separator.
 *
 * @param explode defaults the way OpenAPI does: `true` for `form`, `false` for every other style.
 * @returns the delimiter to join array items with, or `undefined` to repeat the key.
 * @throws SkMcpTemplateError `unsupported_array_style` for a pairing that has no wire form.
 */
export function arraySeparatorFor(
  style: ParameterStyle | undefined,
  explode: boolean | undefined,
  parameterName: string,
): string | undefined {
  const resolved = style ?? "form";
  if (explode ?? resolved === "form") {
    if (resolved !== "form") {
      throw new SkMcpTemplateError(
        "unsupported_array_style",
        `Parameter '${parameterName}' declares style '${resolved}' with explode true, which has no wire form; set explode false.`,
      );
    }
    return undefined;
  }
  return delimiters[resolved];
}

export interface RequestTemplate {
  readonly method: string;
  readonly routeTemplate: string;
  readonly parameters: readonly ParameterBinding[];
  readonly hasBody: boolean;
  /** Wire field names, never agent names. */
  readonly bodyProperties: ReadonlySet<string>;
  readonly bodyAllowsAdditionalProperties: boolean;
  readonly bodyRoot?: string;
  /** Agent key to wire field, for renamed body fields. */
  readonly bodyAliases?: ReadonlyMap<string, string>;
  /** Wire field to fill, for hidden body fields. */
  readonly bodyFills?: ReadonlyMap<string, ArgumentFill>;
  readonly rootFill?: ArgumentFill;
  /**
   * Wire names whose fill must produce a value. Path parameters are always
   * treated as required; this set carries the body fields and body root that
   * the schema declared required.
   */
  readonly requiredFills?: ReadonlySet<string>;
}

export interface RequestTemplateInput {
  readonly method: string;
  readonly route: string;
  readonly parameters?: readonly ParameterBinding[];
  readonly bodyProperties?: readonly string[];
  readonly bodyAllowsAdditionalProperties?: boolean;
  readonly bodyRoot?: string;
  readonly bodyAliases?: ReadonlyMap<string, string>;
  readonly bodyFills?: ReadonlyMap<string, ArgumentFill>;
  readonly rootFill?: ArgumentFill;
  readonly requiredFills?: ReadonlySet<string>;
}

function fitsKind(value: unknown, kind: ParameterKind): boolean {
  switch (kind) {
    case "integer":
      return typeof value === "number" && Number.isSafeInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return typeof value === "string";
  }
}

/**
 * Constants are gated here rather than at call time.
 *
 * A constant the binding cannot carry would otherwise fail every single call
 * with an error nobody in the request path can act on: the agent did not send
 * it and cannot remove it.
 */
function assertConstantFits(binding: ParameterBinding): void {
  const fill = binding.fill;
  if (fill === undefined || fill.kind !== "constant") {
    return;
  }
  const value = fill.value;
  const ok =
    binding.isArray === true
      ? Array.isArray(value) &&
        value.every((item) => fitsKind(item, binding.kind))
      : fitsKind(value, binding.kind);
  if (!ok) {
    throw new SkMcpTemplateError(
      "invalid_fill_constant",
      `The constant filling '${binding.name}' does not fit a ${binding.isArray === true ? "array of " : ""}${binding.kind} ${binding.location} parameter.`,
    );
  }
}

/** The agent-facing names a caller may send. */
export function allowedArgumentNames(
  template: RequestTemplate,
): ReadonlySet<string> {
  const allowed = new Set<string>();
  for (const parameter of template.parameters) {
    if (parameter.fill === undefined) {
      allowed.add(parameter.argument ?? parameter.name);
    }
  }
  const aliased = new Set(template.bodyAliases?.values() ?? []);
  for (const agentName of template.bodyAliases?.keys() ?? []) {
    allowed.add(agentName);
  }
  for (const field of template.bodyProperties) {
    if (!template.bodyFills?.has(field) && !aliased.has(field)) {
      allowed.add(field);
    }
  }
  if (template.bodyRoot !== undefined && template.rootFill === undefined) {
    allowed.add(template.bodyRoot);
  }
  return allowed;
}

/**
 * Wire names the agent may never send.
 *
 * This set beats the free-form body allowance. Without that precedence an open
 * body accepts a hidden field's wire name and the hide is bypassed; and the
 * wire name of a renamed parameter is accepted, consumed by no loop, and
 * dropped in silence.
 */
export function deniedArgumentNames(
  template: RequestTemplate,
): ReadonlySet<string> {
  const denied = new Set<string>();
  for (const parameter of template.parameters) {
    if (parameter.fill !== undefined || parameter.argument !== undefined) {
      denied.add(parameter.name);
    }
  }
  for (const wireName of template.bodyAliases?.values() ?? []) {
    denied.add(wireName);
  }
  for (const wireName of template.bodyFills?.keys() ?? []) {
    denied.add(wireName);
  }
  if (template.bodyRoot !== undefined && template.rootFill !== undefined) {
    denied.add(template.bodyRoot);
  }
  return denied;
}

const reservedHeaderNames = new Set(["authorization", "cookie"]);
const routePlaceholder = /\{([^}:?*]+)[^}]*\}/g;

/** The placeholder names a route template declares, with constraints and modifiers stripped. */
export function routePlaceholderNames(route: string): Set<string> {
  const names = new Set<string>();
  for (const match of route.matchAll(routePlaceholder)) {
    names.add(match[1] as string);
  }
  return names;
}

export function createRequestTemplate(
  input: RequestTemplateInput,
): RequestTemplate {
  const method = input.method.toUpperCase();
  if (!input.route || input.route.trim().length === 0) {
    throw new SkMcpTemplateError(
      "empty_route",
      "Route template must not be empty.",
    );
  }
  const parameters = input.parameters ?? [];
  const bodyAllowsAdditionalProperties =
    input.bodyAllowsAdditionalProperties ?? false;
  const hasBody =
    input.bodyProperties !== undefined ||
    bodyAllowsAdditionalProperties ||
    input.bodyRoot !== undefined;

  if (
    input.bodyRoot !== undefined &&
    (input.bodyProperties !== undefined || bodyAllowsAdditionalProperties)
  ) {
    throw new SkMcpTemplateError(
      "conflicting_body_modes",
      "A template cannot declare both a body root argument and body properties.",
    );
  }

  if (hasBody && (method === "GET" || method === "HEAD")) {
    throw new SkMcpTemplateError(
      "body_not_allowed",
      `A ${method} request cannot declare a body.`,
    );
  }

  const bodyProperties = assertUniqueArgumentNames(
    parameters.map((parameter) => parameter.name),
    input.bodyRoot === undefined
      ? (input.bodyProperties ?? [])
      : [input.bodyRoot],
  );

  const agentNames = new Set<string>();
  for (const parameter of parameters) {
    assertConstantFits(parameter);
    if (parameter.fill === undefined) {
      const agentName = parameter.argument ?? parameter.name;
      if (agentNames.has(agentName)) {
        throw new SkMcpTemplateError(
          "argument_collision",
          `Curation produces two arguments named '${agentName}'.`,
        );
      }
      agentNames.add(agentName);
    }
    if (
      parameter.location === "header" &&
      reservedHeaderNames.has(parameter.name.toLowerCase())
    ) {
      throw new SkMcpTemplateError(
        "identity_carrier_argument",
        `Header parameter '${parameter.name}' collides with an identity carrier; identity is never an argument.`,
      );
    }
    if (parameter.location === "path" && parameter.isArray) {
      throw new SkMcpTemplateError(
        "path_parameter_array",
        `Path parameter '${parameter.name}' cannot be an array.`,
      );
    }
    /**
     * A repeated header is unrepresentable: `ComposedRequest.headers` is a
     * `Record<string, string>`, so the second write would overwrite the first.
     * Folding into one comma-separated value (RFC 9110 §5.3) is the only shape
     * that survives, and it has to be asked for explicitly.
     */
    if (
      parameter.location === "header" &&
      parameter.isArray &&
      parameter.arraySeparator === undefined
    ) {
      throw new SkMcpTemplateError(
        "header_parameter_array",
        `Header parameter '${parameter.name}' is an array but repeats the key, which a header cannot carry; declare explode false.`,
      );
    }
  }

  const normalizedRoute = input.route.replace(
    routePlaceholder,
    (_, name: string) => `{${name}}`,
  );
  const placeholders = routePlaceholderNames(input.route);
  for (const parameter of parameters) {
    if (parameter.location === "path" && !placeholders.has(parameter.name)) {
      throw new SkMcpTemplateError(
        "route_placeholder_mismatch",
        `Path parameter '${parameter.name}' has no '{${parameter.name}}' placeholder in route '${input.route}'.`,
      );
    }
  }
  for (const placeholder of placeholders) {
    if (
      !parameters.some((p) => p.location === "path" && p.name === placeholder)
    ) {
      throw new SkMcpTemplateError(
        "route_placeholder_mismatch",
        `Route placeholder '{${placeholder}}' has no declared path parameter.`,
      );
    }
  }

  for (const agentName of input.bodyAliases?.keys() ?? []) {
    if (agentNames.has(agentName)) {
      throw new SkMcpTemplateError(
        "argument_collision",
        `Curation produces two arguments named '${agentName}'.`,
      );
    }
    agentNames.add(agentName);
  }

  return {
    method,
    routeTemplate: normalizedRoute,
    parameters: [...parameters],
    hasBody,
    bodyProperties: input.bodyRoot === undefined ? bodyProperties : new Set(),
    bodyAllowsAdditionalProperties,
    ...(input.bodyRoot === undefined ? {} : { bodyRoot: input.bodyRoot }),
    ...(input.bodyAliases === undefined || input.bodyAliases.size === 0
      ? {}
      : { bodyAliases: input.bodyAliases }),
    ...(input.bodyFills === undefined || input.bodyFills.size === 0
      ? {}
      : { bodyFills: input.bodyFills }),
    ...(input.rootFill === undefined ? {} : { rootFill: input.rootFill }),
    ...(input.requiredFills === undefined || input.requiredFills.size === 0
      ? {}
      : { requiredFills: input.requiredFills }),
  };
}
