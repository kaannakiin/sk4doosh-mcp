import { PRODUCT_NAME } from "@chat/contracts/common/product";
import {
  authorizationServerMetadataSchema,
  protectedResourceMetadataSchema,
} from "@chat/contracts/integration/authorization-metadata";
import {
  authorizationServerMetadataUrls,
  isSecureEndpoint,
  resourceMetadataUrlFrom,
  verifyAuthorizationServer,
  type AuthorizationServer,
  type DiscoveryFailure,
  type EndpointPolicy,
} from "@chat/contracts/integration/discovery";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../config/configuration.ts";
import { guardedFollow } from "./guarded-http.ts";
import {
  readAuthorizationServerMetadata,
  readResourceMetadata,
  type MetadataFailure,
  type OauthTransport,
} from "./oauth-client.ts";

const REQUEST_TIMEOUT_MS = 5_000;

const MAX_METADATA_BYTES = 64 * 1024;

const MAX_REDIRECTS = 3;

const PROBE_BODY = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: PRODUCT_NAME, version: "0" },
  },
});

/**
 * Guard: an identity mismatch means a different thing in each document, and the
 * two maps keep the distinction. A resource naming somewhere else is a resource
 * that cannot be trusted to say where its tokens come from; an issuer naming
 * somewhere else is a host claiming to be an authorization server it is not.
 */
const RESOURCE_FAILURE: Record<MetadataFailure, DiscoveryFailure> = {
  blocked_address: "blocked_address",
  unreachable: "unreachable",
  malformed: "malformed",
  identity_mismatch: "resource_mismatch",
};

const SERVER_FAILURE: Record<MetadataFailure, DiscoveryFailure> = {
  blocked_address: "blocked_address",
  unreachable: "unreachable",
  malformed: "malformed",
  identity_mismatch: "issuer_mismatch",
};

/**
 * What an MCP endpoint said about who guards it.
 *
 * Guard: four situations that used to collapse into one value. A public server
 * answering `200`, a `401` carrying a bare `Bearer` challenge, a refusal with
 * some other status and a request that never got an answer are different facts,
 * and a caller that cannot tell them apart cannot register a server that needs
 * no authorization at all.
 */
export type AuthorizationProbe =
  | { readonly kind: "open" }
  | { readonly kind: "challenged"; readonly metadataUrl: string | undefined }
  | { readonly kind: "unanswered" }
  | { readonly kind: "blocked" };

export type DiscoveryOutcome =
  | {
      readonly ok: true;
      readonly server: AuthorizationServer;
      readonly metadataUrl: string;
      readonly resourceScopes: readonly string[];
    }
  | {
      readonly ok: false;
      readonly failure: DiscoveryFailure;
    };

@Injectable()
export class AuthorizationDiscoveryService {
  private readonly logger = new Logger(AuthorizationDiscoveryService.name);

  private readonly policy: EndpointPolicy;

  private readonly transport: OauthTransport;

  /**
   * Guard: loopback is reachable only outside production, where the in-repo demo
   * backend is the discovery target. In production the registrant's url is
   * forwarded verbatim, and a process that will fetch its own loopback on
   * request reaches admin surfaces no client can.
   */
  constructor(@Inject(ConfigService) config: ConfigService<AppConfig, true>) {
    this.policy = {
      allowLoopback:
        config.get("environment", { infer: true }) !== "production",
    };
    this.transport = {
      endpoint: this.policy,
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxBytes: MAX_METADATA_BYTES,
    };
  }

  /**
   * Works out where a remote MCP server expects this platform to get a token.
   *
   * @param mcpUrl the endpoint the integration registered
   * @returns the authorization server to use, or why the server was refused
   */
  async discover(mcpUrl: string): Promise<DiscoveryOutcome> {
    if (!isSecureEndpoint(mcpUrl, this.policy)) {
      return { ok: false, failure: "insecure_transport" };
    }

    const challenge = await this.probeAuthorization(mcpUrl);
    if (challenge.kind === "blocked") {
      return { ok: false, failure: "blocked_address" };
    }

    /**
     * Guard: a server that named no metadata url is still asked at the default
     * well-known path. Discovery's job is to find an authorization server, so a
     * probe that produced no challenge is not a reason to stop looking — the
     * caller that cares whether the server is open asks `probeAuthorization`
     * itself.
     */
    const metadataUrl =
      challenge.kind === "challenged" ? challenge.metadataUrl : undefined;

    if (
      metadataUrl !== undefined &&
      !isSecureEndpoint(metadataUrl, this.policy)
    ) {
      return { ok: false, failure: "insecure_transport" };
    }

    const document = await readResourceMetadata(
      mcpUrl,
      metadataUrl,
      this.transport,
    );

    if (document.kind === "failed") {
      return { ok: false, failure: RESOURCE_FAILURE[document.failure] };
    }

    const resource = protectedResourceMetadataSchema.safeParse(document.value);
    if (!resource.success) {
      return { ok: false, failure: "malformed" };
    }

    const [issuer] = resource.data.authorization_servers;
    if (issuer === undefined || !isSecureEndpoint(issuer, this.policy)) {
      return { ok: false, failure: "insecure_transport" };
    }

    for (const candidate of authorizationServerMetadataUrls(issuer)) {
      const raw = await readAuthorizationServerMetadata(
        issuer,
        candidate,
        this.transport,
      );

      if (raw.kind === "failed") {
        if (raw.failure === "unreachable") {
          continue;
        }

        return { ok: false, failure: SERVER_FAILURE[raw.failure] };
      }

      const parsed = authorizationServerMetadataSchema.safeParse(raw.value);
      if (!parsed.success) {
        return { ok: false, failure: "malformed" };
      }

      const verified = verifyAuthorizationServer(
        issuer,
        parsed.data,
        this.policy,
      );

      return verified.ok
        ? {
            ok: true,
            server: verified.server,
            metadataUrl: candidate,
            resourceScopes: resource.data.scopes_supported ?? [],
          }
        : { ok: false, failure: verified.failure };
    }

    return { ok: false, failure: "unreachable" };
  }

  /**
   * Asks the MCP endpoint who guards it, if anyone.
   *
   * Guard: this `POST` follows redirects while the token and registration ones
   * do not. It carries an `initialize` frame and no credential, so a redirected
   * hop has nothing to replay; the same hop on a token request would hand the
   * client secret to whatever host the response named.
   *
   * Guard: the presence of `www-authenticate` decides, not the url parsed out of
   * it. A bare `Bearer` challenge names no `resource_metadata` and parses to
   * `undefined`, and reading that as "no challenge" would present a guarded
   * server's tools to this platform with no token at all.
   *
   * Guard: the body is not parsed. A web server answering `200` to anything is
   * reported open here and refused a step later, when `tools/list` fails to
   * produce a tool — one place decides whether a url is an MCP server, and it is
   * not this one.
   *
   * @param mcpUrl the endpoint the integration named
   * @returns whether it is open, what it challenged with, or why there was no
   * answer
   */
  async probeAuthorization(mcpUrl: string): Promise<AuthorizationProbe> {
    const outcome = await guardedFollow(
      {
        url: mcpUrl,
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: PROBE_BODY,
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxBytes: MAX_METADATA_BYTES,
        maxRedirects: MAX_REDIRECTS,
      },
      this.policy,
    );

    if (outcome.kind === "refused") {
      this.logger.warn(
        `refused an address outside the public internet: ${outcome.reason}`,
      );

      return { kind: "blocked" };
    }

    if (outcome.kind === "failed") {
      return { kind: "unanswered" };
    }

    const { headers, status } = outcome.response;
    const challenge = headers["www-authenticate"];

    if (challenge === undefined && status >= 200 && status < 300) {
      return { kind: "open" };
    }

    return {
      kind: "challenged",
      metadataUrl: resourceMetadataUrlFrom(challenge),
    };
  }
}
