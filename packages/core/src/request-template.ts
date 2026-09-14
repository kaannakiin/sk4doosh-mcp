import { assertUniqueArgumentNames } from "./argument-names.js";
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
  readonly bodyProperties: ReadonlySet<string>;
  readonly bodyAllowsAdditionalProperties: boolean;
  readonly bodyRoot?: string;
}

export interface RequestTemplateInput {
  readonly method: string;
  readonly route: string;
  readonly parameters?: readonly ParameterBinding[];
  readonly bodyProperties?: readonly string[];
  readonly bodyAllowsAdditionalProperties?: boolean;
  readonly bodyRoot?: string;
}

const reservedHeaderNames = new Set(["authorization", "cookie"]);
const routePlaceholder = /\{([^}:?*]+)[^}]*\}/g;

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

  for (const parameter of parameters) {
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
  const placeholders = new Set<string>();
  for (const match of input.route.matchAll(routePlaceholder)) {
    placeholders.add(match[1] as string);
  }
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

  return {
    method,
    routeTemplate: normalizedRoute,
    parameters: [...parameters],
    hasBody,
    bodyProperties: input.bodyRoot === undefined ? bodyProperties : new Set(),
    bodyAllowsAdditionalProperties,
    ...(input.bodyRoot === undefined ? {} : { bodyRoot: input.bodyRoot }),
  };
}
