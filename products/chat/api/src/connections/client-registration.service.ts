import {
  isSecureEndpoint,
  type AuthorizationServer,
  type DiscoveryFailure,
  type EndpointPolicy,
} from "@chat/contracts/integration/discovery";
import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../config/configuration.ts";
import {
  registerClient,
  type MetadataFailure,
  type OauthTransport,
  type RegisteredClientMetadata,
} from "./oauth-client.ts";
import {
  DEFAULT_AUTH_METHOD,
  isTokenEndpointAuthMethod,
  type TokenEndpointAuthMethod,
} from "./token-endpoint-auth.ts";

const REQUEST_TIMEOUT_MS = 10_000;

const MAX_REGISTRATION_BYTES = 64 * 1024;

const CALLBACK_PATH = "connections/callback";

const CLIENT_NAME = "Sk4doosh";

const SOFTWARE_ID = "b1b7b0a4-1f3a-4f5f-9a2e-7c5d3e8f4a61";

const REGISTRATION_FAILURE: Record<MetadataFailure, DiscoveryFailure> = {
  blocked_address: "blocked_address",
  unreachable: "unreachable",
  malformed: "malformed",
  identity_mismatch: "issuer_mismatch",
};

export interface RegisteredClient {
  readonly clientId: string;
  readonly clientSecret: string | undefined;
  readonly clientSecretExpiresAt: Date | undefined;
  readonly registrationAccessToken: string | undefined;
  readonly registrationClientUri: string | undefined;
  readonly tokenEndpointAuthMethod: TokenEndpointAuthMethod;
  readonly redirectUri: string;
}

export type RegistrationOutcome =
  | { readonly kind: "registered"; readonly client: RegisteredClient }
  | { readonly kind: "unsupported" }
  | { readonly kind: "rejected"; readonly error: string }
  | { readonly kind: "unusable"; readonly reason: string }
  | { readonly kind: "refused"; readonly failure: DiscoveryFailure };

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Guard: RFC 7591 sends this as a unix integer and `0` means the secret never
 * expires. `new Date(0)` is 1970, which every later read calls expired — and
 * every connection to that integration would then be refused forever.
 */
function expiryOf(value: unknown): Date | undefined {
  return typeof value === "number" && value > 0
    ? new Date(value * 1000)
    : undefined;
}

@Injectable()
export class ClientRegistrationService {
  private readonly policy: EndpointPolicy;

  private readonly transport: OauthTransport;

  readonly redirectUri: string;

  constructor(@Inject(ConfigService) config: ConfigService<AppConfig, true>) {
    this.policy = {
      allowLoopback:
        config.get("environment", { infer: true }) !== "production",
    };
    this.transport = {
      endpoint: this.policy,
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxBytes: MAX_REGISTRATION_BYTES,
    };

    const auth = config.get("auth", { infer: true });
    const prefix = config.get("pathPrefix", { infer: true });
    this.redirectUri = new URL(
      `${prefix}/${CALLBACK_PATH}`.replace(/\/{2,}/gu, "/"),
      auth.publicApiUrl,
    ).href;
  }

  /**
   * Registers this platform as a client at a server it has never met.
   *
   * Guard: the redirect uri is checked before it is registered. It is this
   * platform's own url, so a misconfigured deployment is a deployment fault —
   * and catching it here fails one registration instead of stranding every user
   * at the authorization server with an error naming neither url.
   *
   * @param server the verified authorization server metadata
   * @param scopes the scopes the protected resource declared, if any
   * @returns the issued client, or why no client was issued
   */
  async register(
    server: AuthorizationServer,
    scopes: readonly string[],
  ): Promise<RegistrationOutcome> {
    if (server.registrationEndpoint === undefined) {
      return { kind: "unsupported" };
    }

    if (!isSecureEndpoint(this.redirectUri, this.policy)) {
      return {
        kind: "unusable",
        reason: `${this.redirectUri} is not a usable callback url`,
      };
    }

    const metadata = {
      client_name: CLIENT_NAME,
      redirect_uris: [this.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: DEFAULT_AUTH_METHOD,
      application_type: "web",
      software_id: SOFTWARE_ID,
      ...(scopes.length === 0 ? {} : { scope: scopes.join(" ") }),
    } satisfies Partial<RegisteredClientMetadata>;

    const response = await registerClient(
      {
        issuer: server.issuer,
        registration_endpoint: server.registrationEndpoint,
      },
      metadata,
      this.transport,
    );

    if (response.kind === "rejected") {
      return { kind: "rejected", error: response.error };
    }

    if (response.kind === "failed") {
      return {
        kind: "refused",
        failure: REGISTRATION_FAILURE[response.failure],
      };
    }

    return this.issued(response.client);
  }

  /**
   * Guard: the method the server registered is read back rather than assumed.
   * RFC 7591 lets it answer with one other than the one requested, and it
   * decides how every later token request authenticates — a request built on the
   * assumption fails at the server with no local sign of why.
   */
  private issued(client: RegisteredClientMetadata): RegistrationOutcome {
    const clientId = stringOf(client.client_id);
    if (clientId === undefined) {
      return { kind: "unusable", reason: "the server issued no client id" };
    }

    const clientSecret = stringOf(client.client_secret);
    const declared =
      stringOf(client.token_endpoint_auth_method) ?? DEFAULT_AUTH_METHOD;

    if (!isTokenEndpointAuthMethod(declared)) {
      return {
        kind: "unusable",
        reason: `the server registered ${declared}, which this platform cannot perform`,
      };
    }

    if ((declared === "none") !== (clientSecret === undefined)) {
      return {
        kind: "unusable",
        reason: `the server registered ${declared} without a matching secret`,
      };
    }

    return {
      kind: "registered",
      client: {
        clientId,
        clientSecret,
        clientSecretExpiresAt:
          clientSecret === undefined
            ? undefined
            : expiryOf(client.client_secret_expires_at),
        registrationAccessToken: stringOf(client.registration_access_token),
        registrationClientUri: stringOf(client.registration_client_uri),
        tokenEndpointAuthMethod: declared,
        redirectUri: this.redirectUri,
      },
    };
  }
}
