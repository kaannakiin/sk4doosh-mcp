import { asciiLower, asciiUpper } from "../platform/ascii.js";
import { mergeCookieHeader } from "@sk-mcp/core";
import type {
  CredentialRef,
  SecurityModel,
  SecurityRequirement,
  SecurityScheme,
} from "@sk-mcp/openapi";
import type { ResolvedCredential } from "../platform/config.js";

export interface Placement {
  readonly scheme: SecurityScheme;
  readonly credential: ResolvedCredential;
}

/** The credentials one invocation writes; empty for an anonymous alternative. */
export type ChosenCredentials = readonly Placement[];

function fits(
  scheme: SecurityScheme,
  credential: ResolvedCredential | undefined,
): credential is ResolvedCredential {
  if (credential === undefined) {
    return false;
  }
  switch (scheme.type) {
    case "apiKey":
      return credential.kind === "value";
    case "http":
      return scheme.scheme === "basic"
        ? credential.kind === "basic"
        : credential.kind === "value" || credential.kind === "exchanged";
    case "oauth2":
    case "openIdConnect":
      return credential.kind === "exchanged";
    case "mutualTLS":
      return false;
  }
}

/**
 * Picks the first alternative whose every scheme a configured credential satisfies. Applying every
 * configured scheme at once was rejected: it sends the backend credentials it did not ask for.
 *
 * @returns the placements to write, or `undefined` when no alternative can be satisfied
 */
export function chooseCredentials(
  requirements: readonly SecurityRequirement[] | undefined,
  schemes: SecurityModel,
  credentials: ReadonlyMap<string, ResolvedCredential>,
): ChosenCredentials | undefined {
  if (requirements === undefined || requirements.length === 0) {
    return [];
  }
  for (const alternative of requirements) {
    const placements: Placement[] = [];
    let satisfied = true;
    for (const ref of alternative.keys()) {
      const scheme = schemes.get(ref as CredentialRef);
      const credential = credentials.get(ref);
      if (scheme === undefined || !fits(scheme, credential)) {
        satisfied = false;
        break;
      }
      placements.push({ scheme, credential });
    }
    if (satisfied) {
      return placements;
    }
  }
  return undefined;
}

export interface OutboundSlots {
  readonly headers: Record<string, string>;
  readonly queryPairs: string[];
  cookie: string | undefined;
}

const encode = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${asciiUpper(c.charCodeAt(0).toString(16))}`,
  );

/**
 * Writes the chosen credentials into their slots. A credential cookie comes before a composed one,
 * and a composed cookie with the same name is `cookie_carrier_collision` rather than an overwrite.
 */
export class ExchangedTokenMissing extends Error {
  constructor() {
    super(
      "sk-mcp-openapi: the operation needs an exchanged token, and the call carried none.",
    );
    this.name = "ExchangedTokenMissing";
  }
}

/**
 * @param exchanged the backend token the caller's own token was exchanged for; required when a
 * placement is satisfied by token exchange
 */
export function applyCredentials(
  placements: ChosenCredentials,
  slots: OutboundSlots,
  exchanged?: string,
): void {
  const credentialCookies: string[] = [];
  for (const { scheme, credential } of placements) {
    if (credential.kind === "exchanged" && exchanged === undefined) {
      throw new ExchangedTokenMissing();
    }
    const value =
      credential.kind === "value"
        ? credential.value
        : credential.kind === "exchanged"
          ? (exchanged ?? "")
          : "";
    switch (scheme.type) {
      case "apiKey":
        if (scheme.in === "header") {
          slots.headers[asciiLower(scheme.name)] = value;
        } else if (scheme.in === "query") {
          slots.queryPairs.push(`${encode(scheme.name)}=${encode(value)}`);
        } else {
          credentialCookies.push(`${scheme.name}=${value}`);
        }
        break;
      case "http":
      case "oauth2":
      case "openIdConnect":
        slots.headers["authorization"] =
          credential.kind === "basic"
            ? `Basic ${Buffer.from(`${credential.username}:${credential.password}`, "utf8").toString("base64")}`
            : `Bearer ${value}`;
        break;
      case "mutualTLS":
        break;
    }
  }
  if (credentialCookies.length > 0) {
    slots.cookie = mergeCookieHeader(
      credentialCookies.join("; "),
      slots.cookie,
    );
  }
}
