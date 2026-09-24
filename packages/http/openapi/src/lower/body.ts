import {
  isBinaryMediaType,
  isJsonMediaType,
  jsonMediaType,
  multipartMediaType,
  textMediaType,
  urlEncodedMediaType,
  type EndpointDescriptor,
  type JsonSchemaObject,
} from "@sk-mcp/core";
import { OperationDropped } from "../diagnostics.js";
import { childPointer, type JsonPointer } from "../ir/brand.js";
import {
  entriesOf,
  isObject,
  objectOf,
  stringOf,
  type JsonObject,
} from "../ir/json.js";
import { resolveComponent } from "../normalize/refs.js";
import { normalizeSlot, type SchemaContext } from "../normalize/schema.js";

type RequestBody = NonNullable<EndpointDescriptor["requestBody"]>;

interface Candidate {
  readonly declared: string;
  readonly mediaType: string;
  readonly media: JsonObject;
}

const bareMediaType = (declared: string): string =>
  (declared.split(";")[0] ?? "").trim().toLowerCase();

const isFileRoot = (schema: JsonSchemaObject): boolean =>
  schema.contentMediaType !== undefined && schema.contentEncoding === undefined;

const hasFileField = (schema: JsonSchemaObject): boolean =>
  Object.values(schema.properties ?? {}).some(
    (property) =>
      (property.contentMediaType !== undefined &&
        property.contentEncoding === undefined) ||
      (property.items?.contentMediaType !== undefined &&
        property.items.contentEncoding === undefined),
  );

/**
 * Picks the one media type the body is written as, in the order of request-bodies.md: JSON (also
 * when a wildcard covers it), another JSON-family type in declared order, urlencoded when no field
 * is a file, multipart, text/plain.
 */
function choose(
  candidates: readonly Candidate[],
  schemaOf: (candidate: Candidate) => JsonSchemaObject,
): Candidate | undefined {
  const exact = candidates.find(
    (candidate) => candidate.mediaType === jsonMediaType,
  );
  if (exact !== undefined) {
    return exact;
  }
  const wildcard = candidates.find(
    (candidate) =>
      candidate.mediaType === "*/*" || candidate.mediaType === "application/*",
  );
  if (wildcard !== undefined) {
    return { ...wildcard, mediaType: jsonMediaType };
  }
  const family = candidates.find((candidate) =>
    isJsonMediaType(candidate.mediaType),
  );
  if (family !== undefined) {
    return family;
  }
  const urlencoded = candidates.find(
    (candidate) => candidate.mediaType === urlEncodedMediaType,
  );
  if (urlencoded !== undefined && !hasFileField(schemaOf(urlencoded))) {
    return urlencoded;
  }
  return (
    candidates.find(
      (candidate) => candidate.mediaType === multipartMediaType,
    ) ??
    candidates.find((candidate) => candidate.mediaType === textMediaType) ??
    candidates.find(
      (candidate) =>
        candidate.mediaType === "application/octet-stream" &&
        isFileRoot(schemaOf(candidate)),
    ) ??
    candidates.find(
      (candidate) =>
        isBinaryMediaType(candidate.mediaType) &&
        !candidate.mediaType.includes("*") &&
        isFileRoot(schemaOf(candidate)),
    )
  );
}

function assertEncoding(media: JsonObject, at: JsonPointer): void {
  for (const [field, raw] of entriesOf(media["encoding"])) {
    const encoding = objectOf(raw);
    const style = stringOf(encoding?.["style"]);
    const unsupported =
      (style !== undefined && style !== "form") ||
      encoding?.["explode"] === false ||
      encoding?.["allowReserved"] === true ||
      objectOf(encoding?.["headers"]) !== undefined;
    if (unsupported) {
      throw new OperationDropped(
        "unsupported_encoding",
        childPointer(at, "encoding", field),
        `The encoding of '${field}' declares a style, explode, allowReserved or part headers the form writers do not produce.`,
      );
    }
  }
}

/**
 * A body whose root admits `null` is a body the backend accepts absent: `null` is not a JSON body
 * a client sends, it is how a generator writes an optional parameter's type (`NotePayload?`). The
 * null member is removed so the root can flatten, and the body is optional unless the document
 * declares it required.
 */
function withoutNullRoot(schema: JsonSchemaObject): {
  readonly schema: JsonSchemaObject;
  readonly nullable: boolean;
} {
  const type = schema.type;
  if (Array.isArray(type) && type.includes("null")) {
    const rest = type.filter((member) => member !== "null");
    return {
      schema: {
        ...schema,
        type: rest.length === 1 ? rest[0] : rest,
      } as JsonSchemaObject,
      nullable: true,
    };
  }
  return { schema, nullable: false };
}

export function lowerRequestBody(
  context: SchemaContext,
  value: unknown,
  at: JsonPointer,
  requiredDefault: "document" | "always" = "document",
): RequestBody | undefined {
  if (value === undefined) {
    return undefined;
  }
  const resolved = resolveComponent(
    context.document,
    isObject(value) ? value : {},
    at,
  );
  if (resolved === undefined) {
    return undefined;
  }
  const { node, at: bodyAt } = resolved;
  const contentAt = childPointer(bodyAt, "content");
  const candidates: Candidate[] = entriesOf(node["content"]).flatMap(
    ([declared, media]) =>
      isObject(media)
        ? [{ declared, mediaType: bareMediaType(declared), media }]
        : [],
  );
  const schemaOf = (candidate: Candidate): JsonSchemaObject => {
    const mediaAt = childPointer(contentAt, candidate.declared);
    const encoding = objectOf(candidate.media["encoding"]);
    return normalizeSlot(
      context,
      candidate.media["schema"],
      childPointer(mediaAt, "schema"),
      {
        direction: "request",
        root: "preferred",
        fileMediaType: (property) =>
          stringOf(objectOf(encoding?.[property])?.["contentType"])
            ?.split(",")[0]
            ?.trim(),
      },
    );
  };
  const chosen = choose(candidates, schemaOf);
  if (chosen === undefined) {
    throw new OperationDropped(
      "unsupported_media_type",
      contentAt,
      `No declared body media type has a writer: ${candidates.map((candidate) => candidate.declared).join(", ") || "none declared"}.`,
    );
  }
  for (const candidate of candidates) {
    if (candidate.declared !== chosen.declared) {
      context.diagnostics.report(
        "request_media_type_alternative_ignored",
        childPointer(contentAt, candidate.declared),
        `The body is written as ${chosen.mediaType}; the alternative ${candidate.declared} is not used.`,
      );
    }
  }
  assertEncoding(chosen.media, childPointer(contentAt, chosen.declared));
  const description = stringOf(node["description"]);
  const { schema: normalized, nullable } = withoutNullRoot(schemaOf(chosen));
  const schema =
    isBinaryMediaType(chosen.mediaType) && isFileRoot(normalized)
      ? { ...normalized, contentMediaType: chosen.mediaType }
      : normalized;
  const required =
    node["required"] === true ||
    (node["required"] === undefined &&
      requiredDefault === "always" &&
      !nullable);
  return {
    schema,
    ...(required ? {} : { required: false }),
    ...(description === undefined ? {} : { description }),
    ...(chosen.mediaType === jsonMediaType
      ? {}
      : { contentType: chosen.mediaType }),
  };
}
