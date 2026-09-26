import type { EndpointDescriptor, IdentityCarrier } from "@liaiso/core";
import type { DiagnosticSink } from "../diagnostics.js";
import { childPointer, rootPointer, type Brand } from "../ir/brand.js";
import {
  arrayOf,
  entriesOf,
  objectOf,
  stringOf,
  type JsonObject,
} from "../ir/json.js";

export type CredentialRef = Brand<string, "CredentialRef">;

export type SecurityScheme =
  | {
      readonly type: "apiKey";
      readonly in: "header" | "query" | "cookie";
      readonly name: string;
    }
  | { readonly type: "http"; readonly scheme: "basic" }
  | {
      readonly type: "http";
      readonly scheme: "bearer";
      readonly bearerFormat?: string;
    }
  | { readonly type: "oauth2"; readonly flows: JsonObject }
  | { readonly type: "openIdConnect"; readonly url: string }
  | { readonly type: "mutualTLS" };

/** One alternative of a `security` list: every scheme in it applies together. */
export type SecurityRequirement = ReadonlyMap<CredentialRef, readonly string[]>;

export type SecurityModel = ReadonlyMap<CredentialRef, SecurityScheme>;

const apiKeyLocations = new Set(["header", "query", "cookie"]);

export function securitySchemesOf(
  document: JsonObject,
  diagnostics: DiagnosticSink,
): SecurityModel {
  const schemes = new Map<CredentialRef, SecurityScheme>();
  const components = objectOf(document["components"]);
  for (const [name, raw] of entriesOf(components?.["securitySchemes"])) {
    const at = childPointer(rootPointer, "components", "securitySchemes", name);
    const scheme = objectOf(raw);
    const type = stringOf(scheme?.["type"]);
    const ref = name as CredentialRef;
    switch (type) {
      case "apiKey": {
        const location = stringOf(scheme?.["in"]) ?? "";
        const key = stringOf(scheme?.["name"]);
        if (!apiKeyLocations.has(location) || key === undefined) {
          diagnostics.report(
            "openapi_document_invalid",
            at,
            "An apiKey scheme needs 'in' (header, query or cookie) and 'name'.",
          );
          continue;
        }
        schemes.set(ref, {
          type: "apiKey",
          in: location as "header" | "query" | "cookie",
          name: key,
        });
        continue;
      }
      case "http": {
        const httpScheme = stringOf(scheme?.["scheme"])?.toLowerCase();
        if (httpScheme === "basic") {
          schemes.set(ref, { type: "http", scheme: "basic" });
        } else if (httpScheme === "bearer") {
          const bearerFormat = stringOf(scheme?.["bearerFormat"]);
          schemes.set(ref, {
            type: "http",
            scheme: "bearer",
            ...(bearerFormat === undefined ? {} : { bearerFormat }),
          });
        } else {
          diagnostics.report(
            "security_scheme_unsupported",
            at,
            `The http scheme '${httpScheme ?? ""}' has no credential placement; only basic and bearer do.`,
          );
        }
        continue;
      }
      case "oauth2":
        schemes.set(ref, {
          type: "oauth2",
          flows: objectOf(scheme?.["flows"]) ?? {},
        });
        continue;
      case "openIdConnect":
        schemes.set(ref, {
          type: "openIdConnect",
          url: stringOf(scheme?.["openIdConnectUrl"]) ?? "",
        });
        continue;
      case "mutualTLS":
        schemes.set(ref, { type: "mutualTLS" });
        continue;
      default:
        diagnostics.report(
          "openapi_document_invalid",
          at,
          `Security scheme type '${type ?? "absent"}' is not defined by OpenAPI.`,
        );
    }
  }
  return schemes;
}

/**
 * The operation's own `security`, else the document's. `undefined` means no list was declared
 * anywhere, which is not the same as an explicit empty list.
 */
export function effectiveSecurity(
  operation: JsonObject,
  document: JsonObject,
): readonly SecurityRequirement[] | undefined {
  const declared = operation["security"] ?? document["security"];
  if (declared === undefined) {
    return undefined;
  }
  return arrayOf(declared).map(
    (alternative) =>
      new Map(
        entriesOf(alternative).map(([name, scopes]) => [
          name as CredentialRef,
          arrayOf(scopes)
            .map(stringOf)
            .filter((scope): scope is string => scope !== undefined),
        ]),
      ),
  );
}

export function isAnonymousAllowed(
  requirements: readonly SecurityRequirement[] | undefined,
): boolean {
  return (
    requirements !== undefined &&
    (requirements.length === 0 ||
      requirements.some((alternative) => alternative.size === 0))
  );
}

export function carriersOf(
  requirements: readonly SecurityRequirement[] | undefined,
  schemes: SecurityModel,
): IdentityCarrier[] {
  const carriers = new Map<string, IdentityCarrier>();
  for (const alternative of requirements ?? []) {
    for (const ref of alternative.keys()) {
      const scheme = schemes.get(ref);
      if (scheme?.type === "apiKey") {
        carriers.set(`${scheme.in}|${scheme.name}`, {
          in: scheme.in,
          name: scheme.name,
        });
      }
    }
  }
  return [...carriers.values()];
}

/**
 * A document says which credential a call needs, never which caller may make it, so nothing but an
 * explicit anonymous alternative is turned into a visibility fact.
 */
export function authOf(
  requirements: readonly SecurityRequirement[] | undefined,
  carriers: readonly IdentityCarrier[],
): EndpointDescriptor["auth"] {
  return {
    anonymous: isAnonymousAllowed(requirements) ? "yes" : "unknown",
    policies: [],
    imperative: false,
    ...(carriers.length === 0 ? {} : { carriers: [...carriers] }),
  };
}
