import {
  isJsonMediaType,
  jsonMediaType,
  multipartMediaType,
  textMediaType,
  urlEncodedMediaType,
  type JsonSchemaObject,
} from "@liaiso/core";
import type { McpFileFieldOptions, McpToolOptions } from "../decorators.js";
import type { DiscoveryDiagnostic } from "./endpoint-discovery.js";

export type FileBinding = "single" | "multiple";

export interface BodyEncodingInput {
  readonly where: string;
  readonly controller: NewableFunction;
  readonly handler: (...args: never[]) => unknown;
  readonly hints: McpToolOptions;
  readonly files: readonly FileBinding[];
  readonly schema: JsonSchemaObject | undefined;
  readonly report: ((diagnostic: DiscoveryDiagnostic) => void) | undefined;
}

/** `objectNotation` is never written: Nest's `qs` reads brackets, and absent means bracket. */
export interface BodyEncoding {
  readonly schema: JsonSchemaObject | undefined;
  readonly contentType?: string;
}

function mediaTypeOf(value: string): string {
  return (value.split(";")[0] ?? "").trim().toLowerCase();
}

function declaredConsumes(
  controller: NewableFunction,
  handler: (...args: never[]) => unknown,
): string[] {
  const read = (target: object): unknown =>
    Reflect.getMetadata("swagger/apiConsumes", target) as unknown;
  const declared = read(handler) ?? read(controller);
  return Array.isArray(declared)
    ? declared
        .filter((entry): entry is string => typeof entry === "string")
        .map(mediaTypeOf)
    : [];
}

function covers(accepted: string, mediaType: string): boolean {
  if (accepted === mediaType || accepted === "*/*") {
    return true;
  }
  return accepted.endsWith("/*") && mediaType.startsWith(accepted.slice(0, -1));
}

/**
 * Chooses from an `@ApiConsumes` list for an endpoint that binds no file.
 *
 * Guard: the choice is what the backend parses, not what the documentation says. Express's
 * default JSON parser reads `application/json` only and leaves a `+json` body unparsed
 * (form-body-probe N6), and Nest has no 415 filter, so the JSON family collapses to
 * `application/json`. Multipart is never chosen here: multer runs only behind a file interceptor,
 * so without a file binding a multipart body would reach the handler empty while a JSON one binds.
 */
function chooseFrom(accepted: readonly string[]): string {
  const concrete = accepted.filter((type) => !type.includes("*"));
  if (
    accepted.some(
      (type) => covers(type, jsonMediaType) || isJsonMediaType(type),
    )
  ) {
    return jsonMediaType;
  }
  if (concrete.includes(urlEncodedMediaType)) {
    return urlEncodedMediaType;
  }
  if (concrete.includes(textMediaType)) {
    return textMediaType;
  }
  const other = concrete.find((type) => type !== multipartMediaType);
  return other ?? jsonMediaType;
}

function isWritable(mediaType: string): boolean {
  return (
    isJsonMediaType(mediaType) ||
    mediaType === urlEncodedMediaType ||
    mediaType === multipartMediaType ||
    mediaType === textMediaType
  );
}

function fileSchemaOf(declaration: McpFileFieldOptions): JsonSchemaObject {
  const part: JsonSchemaObject = {
    type: "string",
    contentMediaType: declaration.mediaType ?? "application/octet-stream",
  };
  const schema: JsonSchemaObject =
    declaration.multiple === true ? { type: "array", items: part } : part;
  return declaration.description === undefined
    ? schema
    : { ...schema, description: declaration.description };
}

function isBinary(schema: JsonSchemaObject | undefined): boolean {
  return (
    schema?.type === "string" &&
    (schema.format === "binary" || schema.contentMediaType !== undefined)
  );
}

/**
 * Reads the file fields `@ApiBody` documents: a body schema property that is `format: "binary"`,
 * or an array of them. The same metadata `@nestjs/swagger` itself writes, read by key so the SDK
 * takes no dependency on it.
 */
function swaggerFileFields(
  handler: (...args: never[]) => unknown,
): Record<string, McpFileFieldOptions> | undefined {
  const parameters = Reflect.getMetadata(
    "swagger/apiParameters",
    handler,
  ) as unknown;
  if (!Array.isArray(parameters)) {
    return undefined;
  }
  const found: Record<string, McpFileFieldOptions> = {};
  for (const parameter of parameters as {
    in?: unknown;
    schema?: JsonSchemaObject;
  }[]) {
    if (parameter.in !== "body") {
      continue;
    }
    const schema = parameter.schema;
    const required = new Set(schema?.required ?? []);
    for (const [name, property] of Object.entries(schema?.properties ?? {})) {
      const multiple = property.type === "array" && isBinary(property.items);
      if (!multiple && !isBinary(property)) {
        continue;
      }
      const part = multiple ? property.items : property;
      found[name] = {
        ...(multiple ? { multiple: true } : {}),
        ...(required.has(name) ? { required: true } : {}),
        ...(property.description === undefined
          ? {}
          : { description: property.description }),
        ...(part?.contentMediaType === undefined
          ? {}
          : { mediaType: part.contentMediaType }),
      };
    }
  }
  return Object.keys(found).length === 0 ? undefined : found;
}

function withFiles(
  schema: JsonSchemaObject | undefined,
  files: Readonly<Record<string, McpFileFieldOptions>>,
): JsonSchemaObject {
  const base = schema ?? { type: "object", properties: {} };
  const required = [
    ...(base.required ?? []),
    ...Object.entries(files)
      .filter(([, declaration]) => declaration.required === true)
      .map(([name]) => name),
  ];
  const properties = { ...(base.properties ?? {}) };
  for (const [name, declaration] of Object.entries(files)) {
    properties[name] = fileSchemaOf(declaration);
  }
  return {
    ...base,
    type: "object",
    properties,
    ...(required.length === 0 ? {} : { required }),
  };
}

/**
 * Inlines a form body's `$ref` members one level deep.
 *
 * The binder hoists every nested DTO into `$defs`, but a form field addresses its members by name
 * on the wire, so the template needs them in place; a reference left behind would drop the
 * endpoint as `unsupported_body_shape` for a shape that is perfectly expressible.
 */
function inlineReferences(
  schema: JsonSchemaObject | undefined,
): JsonSchemaObject | undefined {
  const defs = schema?.$defs;
  if (
    schema === undefined ||
    defs === undefined ||
    schema.properties === undefined
  ) {
    return schema;
  }
  const properties: Record<string, JsonSchemaObject> = {};
  for (const [name, property] of Object.entries(schema.properties)) {
    const reference = /^#\/\$defs\/(.+)$/.exec(property.$ref ?? "")?.[1];
    const target = reference === undefined ? undefined : defs[reference];
    properties[name] =
      target === undefined ? property : structuredClone(target);
  }
  const inlined: JsonSchemaObject = { ...schema, properties };
  if (!JSON.stringify(properties).includes('"$ref"')) {
    delete inlined.$defs;
  }
  return inlined;
}

/**
 * Decides the body's media type and completes its schema with the multipart file fields.
 *
 * @returns `undefined` when the endpoint has to be dropped; the reason has been reported.
 */
export function bodyEncodingOf(
  input: BodyEncodingInput,
): BodyEncoding | undefined {
  const { where, hints, report } = input;
  const hasFiles = input.files.length > 0;
  const accepted = declaredConsumes(input.controller, input.handler);
  let contentType: string;
  if (hints.consumes !== undefined) {
    contentType = mediaTypeOf(hints.consumes);
    if (
      accepted.length > 0 &&
      !accepted.some((type) => covers(type, contentType))
    ) {
      report?.({
        code: "content_type_not_accepted",
        message: `${where} declares consumes '${contentType}', which its @ApiConsumes list (${accepted.join(", ")}) does not accept; endpoint skipped.`,
      });
      return undefined;
    }
  } else if (hasFiles) {
    contentType = multipartMediaType;
  } else {
    contentType = chooseFrom(accepted);
  }

  if (!isWritable(contentType)) {
    report?.({
      code: "unsupported_binding",
      message: `${where} takes a ${contentType} body, which liaiso has no writer for; endpoint skipped.`,
    });
    return undefined;
  }
  if (hasFiles && contentType !== multipartMediaType) {
    report?.({
      code: "content_type_not_accepted",
      message: `${where} binds a file, which only multipart/form-data can carry, but declares '${contentType}'; endpoint skipped.`,
    });
    return undefined;
  }
  if (contentType === multipartMediaType && !hasFiles) {
    report?.({
      code: "body_parser_missing",
      message: `${where} takes a multipart/form-data body, which Nest parses only behind a file interceptor; bind the file with @UploadedFile() or declare another media type. Endpoint skipped.`,
    });
    return undefined;
  }

  let schema = input.schema;
  if (hasFiles) {
    const files = hints.files ?? swaggerFileFields(input.handler);
    if (files === undefined) {
      report?.({
        code: "unresolved_file_field",
        message: `${where} binds an uploaded file, but its multipart field name cannot be read from a file interceptor. Declare it with @McpTool({ files: { <field>: {} } }) or document it with @ApiBody; endpoint skipped.`,
      });
      return undefined;
    }
    schema = withFiles(schema, files);
  }
  if (
    contentType === urlEncodedMediaType ||
    contentType === multipartMediaType
  ) {
    return { schema: inlineReferences(schema), contentType };
  }
  return contentType === jsonMediaType ? { schema } : { schema, contentType };
}
