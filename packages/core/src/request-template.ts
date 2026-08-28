import { SkMcpTemplateError } from "./errors.js";

export type ParameterLocation = "path" | "query" | "header";

export type ParameterKind = "string" | "integer" | "number" | "boolean";

export interface ParameterBinding {
  readonly name: string;
  readonly location: ParameterLocation;
  readonly kind: ParameterKind;
  readonly isArray?: boolean;
}

export interface RequestTemplate {
  readonly method: string;
  readonly routeTemplate: string;
  readonly parameters: readonly ParameterBinding[];
  readonly hasBody: boolean;
  readonly bodyProperties: ReadonlySet<string>;
  readonly bodyAllowsAdditionalProperties: boolean;
}

export interface RequestTemplateInput {
  readonly method: string;
  readonly route: string;
  readonly parameters?: readonly ParameterBinding[];
  readonly bodyProperties?: readonly string[];
  readonly bodyAllowsAdditionalProperties?: boolean;
}

const reservedHeaderNames = new Set(["authorization", "cookie"]);
const routePlaceholder = /\{([^}:?*]+)[^}]*\}/g;

export function createRequestTemplate(
  input: RequestTemplateInput,
): RequestTemplate {
  const method = input.method.toUpperCase();
  if (!input.route || input.route.trim().length === 0) {
    throw new SkMcpTemplateError("Route template must not be empty.");
  }
  const parameters = input.parameters ?? [];
  const bodyAllowsAdditionalProperties =
    input.bodyAllowsAdditionalProperties ?? false;
  const hasBody =
    input.bodyProperties !== undefined || bodyAllowsAdditionalProperties;

  if (hasBody && (method === "GET" || method === "HEAD")) {
    throw new SkMcpTemplateError(`A ${method} request cannot declare a body.`);
  }

  const names = new Set<string>();
  for (const parameter of parameters) {
    if (names.has(parameter.name)) {
      throw new SkMcpTemplateError(
        `Duplicate argument name '${parameter.name}'.`,
      );
    }
    names.add(parameter.name);
    if (
      parameter.location === "header" &&
      reservedHeaderNames.has(parameter.name.toLowerCase())
    ) {
      throw new SkMcpTemplateError(
        `Header parameter '${parameter.name}' collides with an identity carrier; identity is never an argument.`,
      );
    }
    if (parameter.location === "path" && parameter.isArray) {
      throw new SkMcpTemplateError(
        `Path parameter '${parameter.name}' cannot be an array.`,
      );
    }
  }

  const bodyProperties = new Set<string>();
  for (const property of input.bodyProperties ?? []) {
    if (names.has(property)) {
      throw new SkMcpTemplateError(
        `Body property '${property}' collides with a parameter name; rename one of them.`,
      );
    }
    names.add(property);
    bodyProperties.add(property);
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
        `Path parameter '${parameter.name}' has no '{${parameter.name}}' placeholder in route '${input.route}'.`,
      );
    }
  }
  for (const placeholder of placeholders) {
    if (
      !parameters.some((p) => p.location === "path" && p.name === placeholder)
    ) {
      throw new SkMcpTemplateError(
        `Route placeholder '{${placeholder}}' has no declared path parameter.`,
      );
    }
  }

  return {
    method,
    routeTemplate: normalizedRoute,
    parameters: [...parameters],
    hasBody,
    bodyProperties,
    bodyAllowsAdditionalProperties,
  };
}
