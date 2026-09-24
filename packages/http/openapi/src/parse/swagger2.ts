import type { DiagnosticSink } from "../diagnostics.js";
import { childPointer, rootPointer, type JsonPointer } from "../ir/brand.js";
import {
  arrayOf,
  entriesOf,
  isObject,
  objectOf,
  stringOf,
  type JsonObject,
  type JsonValue,
  type MutableJsonObject,
} from "../ir/json.js";

/** Where a node of the upgraded document came from in the author's 2.0 document. */
export type Origins = WeakMap<object, JsonPointer>;

const methods = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
] as const;

const schemaKeys = [
  "type",
  "format",
  "items",
  "enum",
  "default",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "multipleOf",
] as const;

interface Context {
  readonly document: JsonObject;
  readonly diagnostics: DiagnosticSink;
  readonly origins: Origins;
}

function located<T extends object>(
  context: Context,
  node: T,
  at: JsonPointer,
): T {
  context.origins.set(node, at);
  return node;
}

/**
 * Rewrites every 2.0 reference target to its 3.x home. `#/parameters` and `#/responses` point at
 * 2.0 shapes that are converted in place under the same names, so their references move with them.
 */
function rewriteRefs(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(rewriteRefs);
  }
  if (!isObject(value)) {
    return value;
  }
  const out: MutableJsonObject = {};
  for (const [key, child] of entriesOf(value)) {
    if (key === "$ref" && typeof child === "string") {
      out[key] = child
        .replace(/^#\/definitions\//, "#/components/schemas/")
        .replace(/^#\/parameters\//, "#/components/parameters/")
        .replace(/^#\/responses\//, "#/components/responses/");
    } else if (key === "x-nullable" && child === true) {
      out["nullable"] = true;
    } else {
      out[key] = rewriteRefs(child);
    }
  }
  if (out["type"] === "file") {
    out["type"] = "string";
    out["format"] = "binary";
  }
  return out;
}

function resolveParameter(
  context: Context,
  parameter: JsonValue,
): JsonObject | undefined {
  const node = objectOf(parameter);
  const ref = stringOf(node?.["$ref"]);
  if (ref === undefined) {
    return node;
  }
  const name = /^#\/parameters\/(.+)$/.exec(ref)?.[1];
  return name === undefined
    ? undefined
    : objectOf(objectOf(context.document["parameters"])?.[name]);
}

function styleFor(
  location: string,
  collectionFormat: string | undefined,
  context: Context,
  at: JsonPointer,
): MutableJsonObject | undefined {
  switch (collectionFormat ?? "csv") {
    case "csv":
      return location === "path" || location === "header"
        ? { style: "simple", explode: false }
        : { style: "form", explode: false };
    case "ssv":
      if (location === "query") {
        return { style: "spaceDelimited", explode: false };
      }
      break;
    case "pipes":
      if (location === "query") {
        return { style: "pipeDelimited", explode: false };
      }
      break;
    case "multi":
      if (location === "query") {
        return { style: "form", explode: true };
      }
      break;
  }
  context.diagnostics.report(
    "unsupported_collection_format",
    at,
    `collectionFormat '${collectionFormat ?? "csv"}' has no ${location} form.`,
  );
  return undefined;
}

function schemaOfSimple(node: JsonObject): MutableJsonObject {
  const schema: MutableJsonObject = {};
  for (const key of schemaKeys) {
    if (node[key] !== undefined) {
      schema[key] = rewriteRefs(node[key]);
    }
  }
  return schema;
}

function upgradeParameter(
  context: Context,
  parameter: JsonObject,
  at: JsonPointer,
): MutableJsonObject | "drop" {
  const location = stringOf(parameter["in"]) ?? "query";
  const out: MutableJsonObject = {
    name: parameter["name"],
    in: location,
    ...(parameter["required"] === undefined
      ? {}
      : { required: parameter["required"] }),
    ...(parameter["description"] === undefined
      ? {}
      : { description: parameter["description"] }),
    schema: schemaOfSimple(parameter),
  };
  if (parameter["allowEmptyValue"] !== undefined) {
    out["allowEmptyValue"] = parameter["allowEmptyValue"];
  }
  if (parameter["type"] === "array") {
    const style = styleFor(
      location,
      stringOf(parameter["collectionFormat"]),
      context,
      at,
    );
    if (style === undefined) {
      return "drop";
    }
    Object.assign(out, style);
  }
  return located(context, out, at);
}

interface Upgraded {
  readonly parameters: JsonValue[];
  readonly requestBody?: MutableJsonObject;
  readonly dropped: boolean;
}

function upgradeParameters(
  context: Context,
  parameters: readonly JsonValue[],
  consumes: readonly string[],
  at: JsonPointer,
): Upgraded {
  const out: JsonValue[] = [];
  const form: MutableJsonObject = { type: "object", properties: {} };
  const formRequired: string[] = [];
  let hasFormField = false;
  let hasFile = false;
  let requestBody: MutableJsonObject | undefined;
  let dropped = false;
  parameters.forEach((raw, index) => {
    const parameterAt = childPointer(at, index);
    const parameter = resolveParameter(context, raw);
    if (parameter === undefined) {
      out.push(rewriteRefs(raw));
      return;
    }
    const location = stringOf(parameter["in"]);
    if (location === "body") {
      const content: MutableJsonObject = {};
      for (const mediaType of consumes) {
        content[mediaType] = {
          schema: rewriteRefs(parameter["schema"] ?? {}),
        };
      }
      requestBody = located(
        context,
        {
          content,
          required: parameter["required"] === true,
          ...(parameter["description"] === undefined
            ? {}
            : { description: parameter["description"] }),
        },
        parameterAt,
      );
      return;
    }
    if (location === "formData") {
      hasFormField = true;
      const name = stringOf(parameter["name"]) ?? "";
      const schema = schemaOfSimple(parameter);
      if (schema["type"] === "file") {
        hasFile = true;
        schema["type"] = "string";
        schema["format"] = "binary";
      }
      const collectionFormat = stringOf(parameter["collectionFormat"]);
      if (
        parameter["type"] === "array" &&
        collectionFormat !== undefined &&
        collectionFormat !== "multi"
      ) {
        context.diagnostics.report(
          "unsupported_encoding",
          parameterAt,
          `A form field with collectionFormat '${collectionFormat}' has no form-body writer; only repeated keys are written.`,
        );
        dropped = true;
      }
      (form["properties"] as MutableJsonObject)[name] = located(
        context,
        schema,
        parameterAt,
      );
      if (parameter["required"] === true) {
        formRequired.push(name);
      }
      return;
    }
    const upgraded = upgradeParameter(context, parameter, parameterAt);
    if (upgraded === "drop") {
      dropped = true;
      return;
    }
    out.push(upgraded);
  });
  if (hasFormField) {
    const mediaType =
      hasFile || consumes.includes("multipart/form-data")
        ? "multipart/form-data"
        : "application/x-www-form-urlencoded";
    if (formRequired.length > 0) {
      form["required"] = formRequired;
    }
    requestBody = {
      content: { [mediaType]: { schema: form } },
      required: formRequired.length > 0,
    };
  }
  return {
    parameters: out,
    ...(requestBody === undefined ? {} : { requestBody }),
    dropped,
  };
}

function upgradeResponses(
  context: Context,
  responses: JsonValue | undefined,
  produces: readonly string[],
  at: JsonPointer,
): MutableJsonObject {
  const out: MutableJsonObject = {};
  for (const [code, raw] of entriesOf(responses)) {
    const response = objectOf(raw);
    if (response === undefined) {
      continue;
    }
    if (stringOf(response["$ref"]) !== undefined) {
      out[code] = rewriteRefs(response);
      continue;
    }
    const converted: MutableJsonObject = {
      description: response["description"] ?? "",
    };
    if (response["schema"] !== undefined) {
      const content: MutableJsonObject = {};
      for (const mediaType of produces) {
        content[mediaType] = { schema: rewriteRefs(response["schema"]) };
      }
      converted["content"] = content;
    }
    out[code] = located(context, converted, childPointer(at, code));
  }
  return out;
}

function upgradeSecuritySchemes(
  definitions: JsonValue | undefined,
): MutableJsonObject {
  const out: MutableJsonObject = {};
  for (const [name, raw] of entriesOf(definitions)) {
    const scheme = objectOf(raw);
    if (scheme === undefined) {
      continue;
    }
    switch (stringOf(scheme["type"])) {
      case "basic":
        out[name] = { type: "http", scheme: "basic" };
        break;
      case "apiKey":
        out[name] = { type: "apiKey", in: scheme["in"], name: scheme["name"] };
        break;
      case "oauth2": {
        const flow =
          (
            {
              implicit: "implicit",
              password: "password",
              application: "clientCredentials",
              accessCode: "authorizationCode",
            } as const
          )[stringOf(scheme["flow"]) ?? ""] ?? "clientCredentials";
        out[name] = {
          type: "oauth2",
          flows: {
            [flow]: {
              ...(scheme["authorizationUrl"] === undefined
                ? {}
                : { authorizationUrl: scheme["authorizationUrl"] }),
              ...(scheme["tokenUrl"] === undefined
                ? {}
                : { tokenUrl: scheme["tokenUrl"] }),
              scopes: scheme["scopes"] ?? {},
            },
          },
        };
        break;
      }
    }
  }
  return out;
}

function serversOf(document: JsonObject): JsonValue[] {
  const basePath = stringOf(document["basePath"]) ?? "";
  const host = stringOf(document["host"]);
  if (host === undefined) {
    return [{ url: basePath === "" ? "/" : basePath }];
  }
  const schemes = arrayOf(document["schemes"])
    .map(stringOf)
    .filter((scheme): scheme is string => scheme !== undefined);
  const ordered = schemes.length === 0 ? ["https"] : schemes;
  return [...ordered]
    .sort((a, b) => Number(b === "https") - Number(a === "https"))
    .map((scheme) => ({ url: `${scheme}://${host}${basePath}` }));
}

const mediaTypes = (value: JsonValue | undefined): string[] | undefined => {
  const list = arrayOf(value)
    .map(stringOf)
    .filter((item): item is string => item !== undefined);
  return list.length === 0 ? undefined : list;
};

/**
 * Converts a Swagger 2.0 document to the OpenAPI 3 shape the rest of ingestion reads, following
 * swagger2openapi's rules. Nodes that move are recorded in `origins` so a diagnostic still points
 * into the author's document.
 */
export function upgradeSwagger2(
  document: JsonObject,
  diagnostics: DiagnosticSink,
  origins: Origins,
): JsonObject {
  const context: Context = { document, diagnostics, origins };
  const rootConsumes = mediaTypes(document["consumes"]) ?? ["application/json"];
  const rootProduces = mediaTypes(document["produces"]) ?? ["application/json"];

  const componentParameters: MutableJsonObject = {};
  for (const [name, raw] of entriesOf(document["parameters"])) {
    const parameter = objectOf(raw);
    const location = stringOf(parameter?.["in"]);
    if (
      parameter !== undefined &&
      location !== "body" &&
      location !== "formData"
    ) {
      const upgraded = upgradeParameter(
        context,
        parameter,
        childPointer(rootPointer, "parameters", name),
      );
      if (upgraded !== "drop") {
        componentParameters[name] = upgraded;
      }
    }
  }

  const paths: MutableJsonObject = {};
  for (const [path, rawItem] of entriesOf(document["paths"])) {
    const item = objectOf(rawItem);
    if (item === undefined) {
      continue;
    }
    const itemAt = childPointer(rootPointer, "paths", path);
    const shared = arrayOf(item["parameters"]);
    const converted: MutableJsonObject = {};
    for (const method of methods) {
      const operation = objectOf(item[method]);
      if (operation === undefined) {
        continue;
      }
      const operationAt = childPointer(itemAt, method);
      const consumes = mediaTypes(operation["consumes"]) ?? rootConsumes;
      const produces = mediaTypes(operation["produces"]) ?? rootProduces;
      const own = arrayOf(operation["parameters"]);
      const ownKeys = new Set(
        own
          .map((parameter) => resolveParameter(context, parameter))
          .map((parameter) =>
            parameter === undefined
              ? ""
              : `${stringOf(parameter["in"])}|${stringOf(parameter["name"])}`,
          ),
      );
      const inherited = shared.filter((parameter) => {
        const resolved = resolveParameter(context, parameter);
        return (
          resolved === undefined ||
          !ownKeys.has(
            `${stringOf(resolved["in"])}|${stringOf(resolved["name"])}`,
          )
        );
      });
      const upgraded = upgradeParameters(
        context,
        [...inherited, ...own],
        consumes,
        childPointer(operationAt, "parameters"),
      );
      const out: MutableJsonObject = {};
      for (const [key, value] of entriesOf(operation)) {
        if (
          key === "parameters" ||
          key === "consumes" ||
          key === "produces" ||
          key === "responses" ||
          key === "schemes"
        ) {
          continue;
        }
        out[key] = rewriteRefs(value);
      }
      out["parameters"] = upgraded.parameters;
      if (upgraded.requestBody !== undefined) {
        out["requestBody"] = upgraded.requestBody;
      }
      out["responses"] = upgradeResponses(
        context,
        operation["responses"],
        produces,
        childPointer(operationAt, "responses"),
      );
      if (upgraded.dropped) {
        out["x-sk-mcp-dropped"] = true;
      }
      converted[method] = located(context, out, operationAt);
    }
    paths[path] = located(context, converted, itemAt);
  }

  const componentResponses: MutableJsonObject = {};
  const upgradedResponses = upgradeResponses(
    context,
    document["responses"],
    rootProduces,
    childPointer(rootPointer, "responses"),
  );
  Object.assign(componentResponses, upgradedResponses);

  return {
    openapi: "3.0.3",
    info: document["info"] ?? {},
    servers: serversOf(document),
    paths,
    components: {
      schemas: rewriteRefs(document["definitions"] ?? {}),
      parameters: componentParameters,
      responses: componentResponses,
      securitySchemes: upgradeSecuritySchemes(document["securityDefinitions"]),
    },
    ...(document["security"] === undefined
      ? {}
      : { security: document["security"] }),
    ...(document["tags"] === undefined ? {} : { tags: document["tags"] }),
  };
}
