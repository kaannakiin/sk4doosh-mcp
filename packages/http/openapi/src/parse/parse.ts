import { parse as parseYaml } from "yaml";
import { DiagnosticSink } from "../diagnostics.js";
import { childPointer, rootPointer } from "../ir/brand.js";
import { isObject, stringOf, type JsonObject } from "../ir/json.js";

export type DocumentVersion = "2.0" | "3.0" | "3.1" | "3.2";

export function parseDocument(
  text: string,
  diagnostics: DiagnosticSink,
): JsonObject | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    try {
      value = parseYaml(text, { maxAliasCount: 100 });
    } catch (error) {
      diagnostics.report(
        "openapi_document_unparseable",
        rootPointer,
        `The document is neither JSON nor YAML: ${(error as Error).message}`,
      );
      return undefined;
    }
  }
  if (!isObject(value)) {
    diagnostics.report(
      "openapi_document_unparseable",
      rootPointer,
      "The document's root is not an object.",
    );
    return undefined;
  }
  return value;
}

export function versionOf(
  document: JsonObject,
  diagnostics: DiagnosticSink,
): DocumentVersion | undefined {
  const swagger = stringOf(document["swagger"]);
  if (swagger !== undefined) {
    if (swagger === "2.0") {
      return "2.0";
    }
  } else {
    const openapi = stringOf(document["openapi"]) ?? "";
    const match = /^3\.([0-2])\.\d+$/.exec(openapi);
    if (match !== null) {
      return `3.${match[1]}` as DocumentVersion;
    }
  }
  diagnostics.report(
    "openapi_version_unsupported",
    childPointer(rootPointer, swagger === undefined ? "openapi" : "swagger"),
    `Version '${swagger ?? stringOf(document["openapi"]) ?? "absent"}' is not Swagger 2.0 or OpenAPI 3.0, 3.1 or 3.2.`,
  );
  return undefined;
}
