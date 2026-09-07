import type { EndpointDescriptor } from "./generated/endpoint-descriptor.js";
import type { ToolDefinition } from "./generated/tool-definition.js";
import { allowsAdditional, flattenableBody, typeOf } from "./json-schema.js";
import type { JsonSchemaType } from "./json-schema.js";
import { createRequestTemplate } from "./request-template.js";
import type {
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

export function createRequestTemplateFromEndpoint(
  endpoint: EndpointDescriptor,
): RequestTemplate {
  const parameters = (endpoint.parameters ?? []).map(
    (parameter): ParameterBinding => {
      const isArray = typeOf(parameter.schema) === "array";
      const scalar = isArray
        ? typeOf(parameter.schema.items)
        : typeOf(parameter.schema);
      return {
        name: parameter.name,
        location: parameter.in,
        kind: kindOf(scalar),
        isArray,
      };
    },
  );

  const body = endpoint.requestBody?.schema;
  const root = bodyRootOf(body);
  if (root !== undefined) {
    return createRequestTemplate({
      method: endpoint.method,
      route: endpoint.route,
      parameters,
      bodyRoot: root,
    });
  }
  const flattened = flattenableBody(body);
  return createRequestTemplate({
    method: endpoint.method,
    route: endpoint.route,
    parameters,
    ...(flattened === undefined
      ? {}
      : { bodyProperties: Object.keys(flattened.properties) }),
    bodyAllowsAdditionalProperties: allowsAdditional(body),
  });
}

export function createTool(endpoint: EndpointDescriptor, name?: string): Tool {
  return {
    definition: createToolDefinition(endpoint, name),
    template: createRequestTemplateFromEndpoint(endpoint),
  };
}
