import { curationShapeOf, resolveCuration } from "./curation.js";
import type { CurationRelief } from "./curation.js";
import type {
  ArgumentFill,
  EndpointDescriptor,
  ToolVariant,
} from "./generated/endpoint-descriptor.js";
import type { ToolDefinition } from "./generated/tool-definition.js";
import { SkMcpTemplateError } from "./errors.js";
import { allowsAdditional, flattenableBody, typeOf } from "./json-schema.js";
import type { JsonSchemaType } from "./json-schema.js";
import {
  arraySeparatorFor,
  createRequestTemplate,
} from "./request-template.js";
import type {
  ObjectMemberBinding,
  ObjectParameterBinding,
  ParameterBinding,
  ParameterKind,
  RequestTemplate,
} from "./request-template.js";
import { bodyRootOf, createToolDefinition } from "./tool-definition.js";

export interface Tool {
  readonly definition: ToolDefinition;
  readonly template: RequestTemplate;
}

function kindOf(type: JsonSchemaType | undefined): ParameterKind {
  return type === "integer" || type === "number" || type === "boolean"
    ? type
    : "string";
}

const queryScalars = new Set<JsonSchemaType>([
  "string",
  "number",
  "integer",
  "boolean",
]);

/**
 * Builds the binding for an object-valued query parameter.
 *
 * Every rejection an object binding can carry lives here, because this is the
 * only place that sees the descriptor's schema. {@link createRequestTemplate}
 * re-checks what the binding type can still express; nesting is not one of
 * those, since {@link ObjectMemberBinding} has no object kind.
 */
function objectBindingFor(
  parameter: NonNullable<EndpointDescriptor["parameters"]>[number],
  argument: string | undefined,
  fill: ArgumentFill | undefined,
): ObjectParameterBinding {
  if (parameter.style !== "deepObject") {
    throw new SkMcpTemplateError(
      "unsupported_object_style",
      `Parameter '${parameter.name}' has an object schema but declares style '${parameter.style ?? "form"}'; only deepObject has a wire form.`,
    );
  }
  if (parameter.explode === false) {
    throw new SkMcpTemplateError(
      "unsupported_object_style",
      `Parameter '${parameter.name}' declares deepObject with explode false, which OpenAPI leaves undefined; omit explode or set it true.`,
    );
  }
  if (fill !== undefined) {
    throw new SkMcpTemplateError(
      "unsupported_object_style",
      `Parameter '${parameter.name}' is an object and cannot be hidden or filled.`,
    );
  }
  const members: ObjectMemberBinding[] = [];
  for (const [name, schema] of Object.entries(
    parameter.schema.properties ?? {},
  )) {
    const type = typeOf(schema);
    const isArray = type === "array";
    const scalar = isArray ? typeOf(schema.items) : type;
    if (
      !queryScalars.has(scalar as JsonSchemaType) ||
      schema.$ref !== undefined ||
      schema.$defs !== undefined
    ) {
      throw new SkMcpTemplateError(
        "unsupported_object_nesting",
        `Member '${parameter.name}.${name}' is not a query scalar or an array of them; flatten it out of the object.`,
      );
    }
    members.push({
      name,
      kind: kindOf(scalar),
      ...(isArray ? { isArray: true } : {}),
    });
  }
  return {
    name: parameter.name,
    location: parameter.in,
    kind: "object",
    notation: parameter.objectNotation ?? "bracket",
    members,
    ...(argument === undefined ? {} : { argument }),
  };
}

export function createRequestTemplateFromEndpoint(
  endpoint: EndpointDescriptor,
  variant?: ToolVariant,
  relief?: CurationRelief,
): RequestTemplate {
  const declared = endpoint.parameters ?? [];
  const parameterNames = declared.map((parameter) => parameter.name);
  const body = endpoint.requestBody?.schema;
  const bodyRequired = endpoint.requestBody?.required;
  const root = bodyRootOf(body, bodyRequired, parameterNames);
  const flattened = root === undefined ? flattenableBody(body) : undefined;
  const curation = resolveCuration(
    endpoint,
    variant,
    curationShapeOf(
      parameterNames,
      declared.filter((parameter) => parameter.required).map((p) => p.name),
      flattened === undefined ? [] : Object.keys(flattened.properties),
      flattened?.required ?? [],
      root,
      bodyRequired !== false,
    ),
    relief,
  );

  const requiredFills = new Set<string>();
  const parameters = declared.map((parameter): ParameterBinding => {
    if (
      parameter.style === "deepObject" ||
      typeOf(parameter.schema) === "object"
    ) {
      const object = curation.byWireName.get(parameter.name);
      return objectBindingFor(parameter, object?.argument, object?.fill);
    }
    const isArray = typeOf(parameter.schema) === "array";
    const scalar = isArray
      ? typeOf(parameter.schema.items)
      : typeOf(parameter.schema);
    const arraySeparator = isArray
      ? arraySeparatorFor(parameter.style, parameter.explode, parameter.name)
      : undefined;
    const resolved = curation.byWireName.get(parameter.name);
    if (resolved?.fill !== undefined && parameter.required) {
      requiredFills.add(parameter.name);
    }
    return {
      name: parameter.name,
      location: parameter.in,
      kind: kindOf(scalar),
      isArray,
      ...(arraySeparator === undefined ? {} : { arraySeparator }),
      ...(resolved?.argument === undefined
        ? {}
        : { argument: resolved.argument }),
      ...(resolved?.fill === undefined ? {} : { fill: resolved.fill }),
    };
  });

  if (root !== undefined) {
    const resolved = curation.byWireName.get(root);
    if (resolved?.fill !== undefined && bodyRequired !== false) {
      requiredFills.add(root);
    }
    return createRequestTemplate({
      method: endpoint.method,
      route: endpoint.route,
      parameters,
      bodyRoot: root,
      ...(resolved?.fill === undefined ? {} : { rootFill: resolved.fill }),
      ...(requiredFills.size === 0 ? {} : { requiredFills }),
    });
  }

  const bodyAliases = new Map<string, string>();
  const bodyFills = new Map<string, ArgumentFill>();
  for (const field of Object.keys(flattened?.properties ?? {})) {
    const resolved = curation.byWireName.get(field);
    if (resolved?.argument !== undefined) {
      bodyAliases.set(resolved.argument, field);
    }
    if (resolved?.fill !== undefined) {
      bodyFills.set(field, resolved.fill);
      if (flattened?.required.includes(field) === true) {
        requiredFills.add(field);
      }
    }
  }

  return createRequestTemplate({
    method: endpoint.method,
    route: endpoint.route,
    parameters,
    ...(flattened === undefined
      ? {}
      : { bodyProperties: Object.keys(flattened.properties) }),
    bodyAllowsAdditionalProperties: allowsAdditional(body),
    ...(bodyAliases.size === 0 ? {} : { bodyAliases }),
    ...(bodyFills.size === 0 ? {} : { bodyFills }),
    ...(requiredFills.size === 0 ? {} : { requiredFills }),
  });
}

export function createTool(
  endpoint: EndpointDescriptor,
  name?: string,
  variant?: ToolVariant,
  relief?: CurationRelief,
): Tool {
  return {
    definition: createToolDefinition(endpoint, name, variant, relief),
    template: createRequestTemplateFromEndpoint(endpoint, variant, relief),
  };
}
