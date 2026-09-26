import { isJsonMediaType, type EndpointDescriptor } from "@liaiso/core";
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

type Responses = NonNullable<EndpointDescriptor["responses"]>;

const streamingMediaTypes = new Set([
  "text/event-stream",
  "application/jsonl",
  "application/x-ndjson",
  "application/json-seq",
  "multipart/mixed",
]);

const bare = (declared: string): string =>
  (declared.split(";")[0] ?? "").trim().toLowerCase();

function jsonMedia(
  content: unknown,
): { declared: string; media: JsonObject } | undefined {
  for (const [declared, media] of entriesOf(content)) {
    const mediaType = bare(declared);
    if (
      isObject(media) &&
      media["itemSchema"] === undefined &&
      (isJsonMediaType(mediaType) || mediaType === "*/*")
    ) {
      return { declared, media };
    }
  }
  return undefined;
}

function isStreamingOnly(content: unknown): boolean {
  const entries = entriesOf(content);
  return (
    entries.length > 0 &&
    entries.every(
      ([declared, media]) =>
        streamingMediaTypes.has(bare(declared)) ||
        (isObject(media) && media["itemSchema"] !== undefined),
    )
  );
}

export function lowerResponses(
  context: SchemaContext,
  value: unknown,
  at: JsonPointer,
  withSchemas: boolean,
): Responses | undefined {
  const out: Record<string, Responses[string]> = {};
  for (const [code, raw] of entriesOf(value)) {
    if (!/^([1-5][0-9]{2}|[1-5]XX|default)$/.test(code)) {
      continue;
    }
    const codeAt = childPointer(at, code);
    const resolved = resolveComponent(
      context.document,
      isObject(raw) ? raw : {},
      codeAt,
    );
    if (resolved === undefined) {
      continue;
    }
    const { node, at: responseAt } = resolved;
    if (objectOf(node["links"]) !== undefined) {
      context.diagnostics.report(
        "links_ignored",
        childPointer(responseAt, "links"),
        "Response links describe follow-up calls the agent finds by search; they are not carried.",
      );
    }
    if (code.startsWith("2") && isStreamingOnly(node["content"])) {
      throw new OperationDropped(
        "streaming_response_unsupported",
        childPointer(responseAt, "content"),
        `The ${code} response is only a streaming sequence, which an invocation cannot return as one result.`,
      );
    }
    const description = stringOf(node["description"]);
    const json = withSchemas ? jsonMedia(node["content"]) : undefined;
    const schema =
      json?.media["schema"] === undefined
        ? undefined
        : normalizeSlot(
            context,
            json.media["schema"],
            childPointer(responseAt, "content", json.declared, "schema"),
            { direction: "response", root: "preferred" },
          );
    out[code] = {
      ...(schema === undefined ? {} : { schema }),
      ...(description === undefined || description === ""
        ? {}
        : { description }),
    };
  }
  return Object.keys(out).length === 0 ? undefined : out;
}
