import type { EndpointDescriptor, IdentityCarrier } from "@liaiso/core";
import { OperationDropped, type DiagnosticSink } from "../diagnostics.js";
import { childPointer, type JsonPointer } from "../ir/brand.js";
import {
  arrayOf,
  booleanOf,
  entriesOf,
  objectOf,
  stringOf,
  type JsonObject,
  type JsonValue,
} from "../ir/json.js";
import { resolveComponent } from "../normalize/refs.js";
import { normalizeSlot, type SchemaContext } from "../normalize/schema.js";

type Parameter = NonNullable<EndpointDescriptor["parameters"]>[number];
type Location = Parameter["in"];
type Style = NonNullable<Parameter["style"]>;

export const defaultCookieDenyList = /^(session|sid|token|auth|jwt)$|sess/i;

const reservedHeaders = new Set(["accept", "content-type", "authorization"]);

const locations = new Set<string>([
  "path",
  "query",
  "header",
  "cookie",
  "querystring",
]);

type StyledLocation = Exclude<Location, "querystring">;

const defaultStyle: Readonly<Record<StyledLocation, Style>> = {
  path: "simple",
  query: "form",
  header: "simple",
  cookie: "form",
};

type ContentType = NonNullable<Parameter["contentType"]>;

const parameterContentTypes: ReadonlySet<string> = new Set<ContentType>([
  "application/json",
  "text/plain",
  "application/x-www-form-urlencoded",
]);

/**
 * The media type a `content` parameter is serialized as, or `undefined` when the composer writes
 * none; a JSON-family type is written as JSON.
 */
function contentTypeOf(declared: string): ContentType | undefined {
  const bare = (declared.split(";")[0] ?? "").trim().toLowerCase();
  if (parameterContentTypes.has(bare)) {
    return bare as ContentType;
  }
  return /\+json$/.test(bare) || bare === "text/json"
    ? "application/json"
    : undefined;
}

export interface ParameterContext extends SchemaContext {
  readonly diagnostics: DiagnosticSink;
  readonly cookieDenyList: RegExp;
}

export interface LoweredParameters {
  readonly parameters: Parameter[];
  readonly carriers: IdentityCarrier[];
}

interface Located {
  readonly node: JsonObject;
  readonly at: JsonPointer;
}

function collect(
  context: ParameterContext,
  lists: ReadonlyArray<{
    readonly values: JsonValue | undefined;
    readonly at: JsonPointer;
  }>,
): Located[] {
  const byKey = new Map<string, Located>();
  for (const list of lists) {
    arrayOf(list.values).forEach((value, index) => {
      const resolved = resolveComponent(
        context.document,
        value,
        childPointer(list.at, index),
      );
      if (resolved === undefined) {
        return;
      }
      const key = `${stringOf(resolved.node["in"])}|${stringOf(resolved.node["name"])}`;
      byKey.set(key, resolved);
    });
  }
  return [...byKey.values()];
}

/**
 * Lowers the path item's and the operation's parameters. The operation's list wins over the path
 * item's for the same `(name, in)` pair; merging by name alone would collapse a query `id` into a
 * path `id`.
 *
 * @param credentialSlots the slots the operation's security schemes write a credential into
 */
export function lowerParameters(
  context: ParameterContext,
  pathItem: {
    readonly values: JsonValue | undefined;
    readonly at: JsonPointer;
  },
  operation: {
    readonly values: JsonValue | undefined;
    readonly at: JsonPointer;
  },
  credentialSlots: readonly IdentityCarrier[],
  identityCookies: ReadonlySet<string>,
): LoweredParameters {
  const parameters: Parameter[] = [];
  const carriers: IdentityCarrier[] = [];
  for (const { node, at } of collect(context, [pathItem, operation])) {
    const name = stringOf(node["name"]);
    const location = stringOf(node["in"]);
    if (name === undefined || location === undefined) {
      context.diagnostics.report(
        "openapi_document_invalid",
        at,
        "A parameter needs 'name' and 'in'.",
      );
      continue;
    }
    if (!locations.has(location)) {
      context.diagnostics.report(
        "openapi_document_invalid",
        childPointer(at, "in"),
        `Parameter location '${location}' is not defined by OpenAPI; the parameter is ignored.`,
      );
      continue;
    }
    const where = location as Location;
    if (where === "header" && reservedHeaders.has(name.toLowerCase())) {
      context.diagnostics.report(
        "reserved_header_parameter_ignored",
        at,
        `Header parameter '${name}' is ignored, as OpenAPI requires; ${name.toLowerCase() === "authorization" ? "the credential arrives through a security scheme" : "the composer writes it"}.`,
      );
      continue;
    }
    const occupies = credentialSlots.find(
      (slot) =>
        slot.in === where &&
        (where === "header"
          ? slot.name.toLowerCase() === name.toLowerCase()
          : slot.name === name),
    );
    if (occupies !== undefined) {
      context.diagnostics.report(
        "credential_parameter_ignored",
        at,
        `${where} parameter '${name}' is the slot a security scheme writes its credential into; it is not an argument.`,
      );
      continue;
    }
    if (
      where === "cookie" &&
      (identityCookies.has(name) || context.cookieDenyList.test(name))
    ) {
      carriers.push({ in: "cookie", name });
      context.diagnostics.report(
        "identity_cookie_parameter",
        at,
        `Cookie parameter '${name}' carries identity and is never an argument.`,
      );
      if (!identityCookies.has(name)) {
        context.diagnostics.report(
          "identity_cookie_uncovered",
          at,
          `Cookie '${name}' looks like a session cookie but no security scheme declares it; no credential is configured for it.`,
        );
      }
      continue;
    }
    if (node["allowEmptyValue"] !== undefined) {
      context.diagnostics.report(
        "allow_empty_value_ignored",
        childPointer(at, "allowEmptyValue"),
        "allowEmptyValue is ignored; an empty string already writes 'key='.",
      );
    }
    const description = stringOf(node["description"]);
    const content = entriesOf(node["content"]);
    if (content.length > 0 || where === "querystring") {
      const [declared, media] = content[0] ?? ["", undefined];
      const contentType = contentTypeOf(declared);
      if (contentType === undefined || content.length !== 1) {
        throw new OperationDropped(
          "unsupported_parameter_content",
          childPointer(at, "content"),
          `Parameter '${name}' is serialized as ${declared === "" ? "no media type" : declared}, which the composer does not write; only JSON, text/plain and — for a querystring — urlencoded content are.`,
        );
      }
      parameters.push({
        name,
        in: where,
        required:
          where === "path" ? true : booleanOf(node["required"]) === true,
        schema: normalizeSlot(
          context,
          objectOf(media)?.["schema"],
          childPointer(at, "content", declared, "schema"),
          { direction: "request", root: "preferred" },
        ),
        contentType,
        ...(description === undefined ? {} : { description }),
      });
      continue;
    }
    const allowReserved =
      where === "query" && booleanOf(node["allowReserved"]) === true;
    const schema = normalizeSlot(
      context,
      node["schema"],
      childPointer(at, "schema"),
      {
        direction: "request",
        root: "required",
      },
    );
    const isArray =
      schema.type === "array" ||
      (Array.isArray(schema.type) && schema.type.includes("array"));
    const declaredStyle = stringOf(node["style"]) as Style | undefined;
    const style = declaredStyle ?? defaultStyle[where as StyledLocation];
    const declaredExplode = booleanOf(node["explode"]);
    parameters.push({
      name,
      in: where,
      required: where === "path" ? true : booleanOf(node["required"]) === true,
      schema,
      ...(style === "deepObject" || isArray || declaredStyle !== undefined
        ? { style }
        : {}),
      ...(isArray || declaredExplode !== undefined
        ? { explode: declaredExplode ?? style === "form" }
        : {}),
      ...(allowReserved ? { allowReserved: true } : {}),
      ...(description === undefined ? {} : { description }),
    });
  }
  return { parameters, carriers };
}
