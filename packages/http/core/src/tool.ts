import { curationShapeOf, resolveCuration } from "./curation.js";
import type { CurationRelief } from "./curation.js";
import type {
  ArgumentFill,
  EndpointDescriptor,
  ToolVariant,
} from "./generated/endpoint-descriptor.js";
import type { ToolDefinition } from "./generated/tool-definition.js";
import { SkMcpTemplateError } from "./errors.js";
import {
  fileSourcesOf,
  isFileArraySchema,
  isFileSchema,
} from "./file-argument.js";
import type { FileOptions } from "./file-argument.js";
import type { JsonSchemaObject } from "./generated/endpoint-descriptor.js";
import { allowsAdditional, flattenableBody, typeOf } from "./json-schema.js";
import type { JsonSchemaType } from "./json-schema.js";
import {
  createRequestTemplate,
  isBinaryMediaType,
  isFormMediaType,
  serializationFor,
} from "./request-template.js";
import type {
  ContentParameterBinding,
  FormBinding,
  FormFieldBinding,
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

/**
 * Builds the binding of a content-serialized parameter. A urlencoded querystring freezes its
 * members from the schema, as an object query parameter does, so the agent's own key order cannot
 * change the composed string.
 */
function contentBindingFor(
  parameter: NonNullable<EndpointDescriptor["parameters"]>[number],
  argument: string | undefined,
  fill: ArgumentFill | undefined,
): ContentParameterBinding {
  if (parameter.style !== undefined || parameter.explode !== undefined) {
    throw new SkMcpTemplateError(
      "unsupported_parameter_content",
      `Parameter '${parameter.name}' is serialized as ${String(parameter.contentType)} and cannot also declare a style.`,
    );
  }
  const mediaType =
    parameter.contentType as ContentParameterBinding["mediaType"];
  const members: ObjectMemberBinding[] = [];
  if (mediaType === "application/x-www-form-urlencoded") {
    for (const [name, schema] of Object.entries(
      parameter.schema.properties ?? {},
    )) {
      const type = typeOf(schema);
      const isArray = type === "array";
      const scalar = isArray ? typeOf(schema.items) : type;
      if (!queryScalars.has(scalar as JsonSchemaType)) {
        throw new SkMcpTemplateError(
          "unsupported_object_nesting",
          `Member '${parameter.name}.${name}' is not a query scalar or an array of them.`,
        );
      }
      members.push({
        name,
        kind: kindOf(scalar),
        ...(isArray ? { isArray: true } : {}),
      });
    }
  }
  return {
    name: parameter.name,
    location: parameter.in,
    kind: "content",
    mediaType,
    ...(members.length === 0 ? {} : { members }),
    ...(argument === undefined ? {} : { argument }),
    ...(fill === undefined ? {} : { fill }),
  };
}

function isQueryScalar(schema: JsonSchemaObject | undefined): boolean {
  return (
    queryScalars.has(typeOf(schema) as JsonSchemaType) &&
    schema?.$ref === undefined &&
    schema?.$defs === undefined
  );
}

function formFieldFor(
  name: string,
  schema: JsonSchemaObject,
): FormFieldBinding {
  if (isFileSchema(schema)) {
    return {
      name,
      kind: "file",
      ...(schema.contentMediaType === undefined
        ? {}
        : { mediaType: schema.contentMediaType }),
    };
  }
  if (isFileArraySchema(schema)) {
    const mediaType = schema.items?.contentMediaType;
    return {
      name,
      kind: "file",
      isArray: true,
      ...(mediaType === undefined ? {} : { mediaType }),
    };
  }
  if (isQueryScalar(schema)) {
    return { name, kind: kindOf(typeOf(schema)) };
  }
  if (typeOf(schema) === "array" && isQueryScalar(schema.items)) {
    return { name, kind: kindOf(typeOf(schema.items)), isArray: true };
  }
  if (
    typeOf(schema) === "object" &&
    schema.$ref === undefined &&
    schema.properties !== undefined
  ) {
    const members: ObjectMemberBinding[] = [];
    for (const [member, memberSchema] of Object.entries(schema.properties)) {
      const isArray = typeOf(memberSchema) === "array";
      const scalar = isArray ? memberSchema.items : memberSchema;
      if (!isQueryScalar(scalar)) {
        throw new SkMcpTemplateError(
          "unsupported_body_shape",
          `Member '${name}.${member}' is not a form scalar or an array of them; a form body carries one level of nesting.`,
        );
      }
      members.push({
        name: member,
        kind: kindOf(typeOf(scalar)),
        ...(isArray ? { isArray: true } : {}),
      });
    }
    return { name, kind: "object", members };
  }
  throw new SkMcpTemplateError(
    "unsupported_body_shape",
    `Field '${name}' is not a form scalar, an array of them, a one-level object or a file.`,
  );
}

/**
 * Freezes a form or multipart body's field list from the descriptor.
 *
 * @param properties the flattened body's properties, or the body root's own in root mode.
 */
function formBindingFor(
  endpoint: EndpointDescriptor,
  properties: Readonly<Record<string, JsonSchemaObject>> | undefined,
): FormBinding {
  if (properties === undefined) {
    throw new SkMcpTemplateError(
      "unsupported_body_shape",
      `A ${endpoint.requestBody?.contentType ?? ""} body must be an object with declared properties.`,
    );
  }
  return {
    notation: endpoint.requestBody?.objectNotation ?? "bracket",
    fields: Object.entries(properties).map(([name, schema]) =>
      formFieldFor(name, schema),
    ),
  };
}

export function createRequestTemplateFromEndpoint(
  endpoint: EndpointDescriptor,
  variant?: ToolVariant,
  relief?: CurationRelief,
  files?: FileOptions,
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
    if (parameter.contentType !== undefined) {
      const resolved = curation.byWireName.get(parameter.name);
      if (resolved?.fill !== undefined && parameter.required) {
        requiredFills.add(parameter.name);
      }
      return contentBindingFor(parameter, resolved?.argument, resolved?.fill);
    }
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
    const serialization = serializationFor(
      parameter.in,
      parameter.style,
      parameter.explode,
      isArray,
      parameter.name,
      parameter.allowReserved,
    );
    const resolved = curation.byWireName.get(parameter.name);
    if (resolved?.fill !== undefined && parameter.required) {
      requiredFills.add(parameter.name);
    }
    return {
      name: parameter.name,
      location: parameter.in,
      kind: kindOf(scalar),
      isArray,
      ...serialization,
      ...(resolved?.argument === undefined
        ? {}
        : { argument: resolved.argument }),
      ...(resolved?.fill === undefined ? {} : { fill: resolved.fill }),
    };
  });

  const contentType = endpoint.requestBody?.contentType;
  const isForm = contentType !== undefined && isFormMediaType(contentType);
  const binaryBody =
    contentType !== undefined &&
    isBinaryMediaType(contentType) &&
    isFileSchema(body);
  const carriers = endpoint.auth.carriers;
  const encoding = {
    ...(contentType === undefined ? {} : { contentType }),
    fileSources: fileSourcesOf(files),
    ...(carriers === undefined ? {} : { carriers }),
    ...(binaryBody ? { binaryBody: true } : {}),
  };

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
      ...encoding,
      ...(isForm
        ? {
            form: formBindingFor(
              endpoint,
              typeOf(body) === "object" ? body?.properties : undefined,
            ),
          }
        : {}),
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
    ...encoding,
    ...(isForm
      ? { form: formBindingFor(endpoint, flattened?.properties) }
      : {}),
  });
}

export function createTool(
  endpoint: EndpointDescriptor,
  name?: string,
  variant?: ToolVariant,
  relief?: CurationRelief,
  files?: FileOptions,
): Tool {
  return {
    definition: createToolDefinition(endpoint, name, variant, relief, files),
    template: createRequestTemplateFromEndpoint(
      endpoint,
      variant,
      relief,
      files,
    ),
  };
}
