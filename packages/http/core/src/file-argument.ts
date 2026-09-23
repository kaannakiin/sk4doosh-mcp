import type { JsonSchemaObject } from "./generated/endpoint-descriptor.js";
import { typeOf } from "./json-schema.js";
import type { FileSource } from "./request-template.js";
import { defaultFileSources } from "./request-template.js";

/** The host's file configuration, as far as the catalog sees it. */
export interface FileOptions {
  /** Present means a resolver is bound: file arguments offer `ref`, described by this text. */
  readonly refDescription?: string;
}

export function fileSourcesOf(
  files: FileOptions | undefined,
): ReadonlySet<FileSource> {
  return files?.refDescription === undefined
    ? defaultFileSources
    : new Set<FileSource>(["text", "base64", "ref"]);
}

/** A property the descriptor marks as a file part: `contentMediaType` and no `contentEncoding`. */
export function isFileSchema(schema: JsonSchemaObject | undefined): boolean {
  return (
    schema !== undefined &&
    typeof schema.contentMediaType === "string" &&
    schema.contentEncoding === undefined
  );
}

export function isFileArraySchema(
  schema: JsonSchemaObject | undefined,
): boolean {
  return typeOf(schema) === "array" && isFileSchema(schema?.items);
}

function mediaTypeDefault(declared: string | undefined): string {
  return declared !== undefined &&
    !declared.includes("*") &&
    declared !== "application/octet-stream"
    ? `Defaults to ${declared}.`
    : "Defaults to text/plain; charset=utf-8 for text and application/octet-stream otherwise.";
}

/**
 * The argument an agent sends for one file part.
 *
 * `oneOf` is safe here: an operation's schema reaches the agent as data inside a `load_tool`
 * result and is never registered with a client's function-calling layer. The byte limit is
 * deliberately absent, so the definition does not change with the host's budget; the refusal
 * names it instead.
 */
export function fileArgumentSchema(
  fileSchema: JsonSchemaObject,
  wireName: string,
  files: FileOptions | undefined,
): JsonSchemaObject {
  const ref = files?.refDescription;
  const properties: Record<string, JsonSchemaObject> = {
    text: {
      type: "string",
      description: "The file's content as text, sent as is.",
    },
    base64: {
      type: "string",
      contentEncoding: "base64",
      description:
        "The file's bytes as standard base64 with padding and no line breaks.",
    },
    ...(ref === undefined ? {} : { ref: { type: "string", description: ref } }),
    name: {
      type: "string",
      description: `The filename the backend receives. Defaults to '${wireName}'.`,
    },
    mediaType: {
      type: "string",
      description: `The file's media type. ${mediaTypeDefault(fileSchema.contentMediaType)}`,
    },
  };
  return {
    type: "object",
    ...(fileSchema.description === undefined
      ? {}
      : { description: fileSchema.description }),
    properties,
    additionalProperties: false,
    oneOf: [
      { required: ["text"] },
      { required: ["base64"] },
      ...(ref === undefined ? [] : [{ required: ["ref"] }]),
    ],
  };
}

/**
 * Replaces a file property's schema with the file argument, leaving every other schema alone.
 *
 * @returns a new schema for a file or file array; `schema` itself otherwise.
 */
export function publishFileSchema(
  schema: JsonSchemaObject,
  wireName: string,
  files: FileOptions | undefined,
): JsonSchemaObject {
  if (isFileSchema(schema)) {
    return fileArgumentSchema(schema, wireName, files);
  }
  if (isFileArraySchema(schema)) {
    const { items, ...rest } = schema;
    return {
      ...rest,
      items: fileArgumentSchema(items as JsonSchemaObject, wireName, files),
    };
  }
  return schema;
}
