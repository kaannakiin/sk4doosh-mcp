import {
  authorizationServerMetadataSchema,
  protectedResourceMetadataSchema,
} from "@chat/contracts/integration/authorization-metadata";
import {
  authorizationServerMetadataUrls,
  defaultResourceMetadataUrl,
  isSecureEndpoint,
  resourceMetadataUrlFrom,
  verifyAuthorizationServer,
  verifyProtectedResource,
  type AuthorizationServer,
  type DiscoveryFailure,
  type EndpointPolicy,
} from "@chat/contracts/integration/discovery";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../config/configuration.ts";
import { guardedRequest, type GuardedResponse } from "./guarded-http.ts";

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
    clientInfo: { name: "sk4doosh", version: "0" },
  },
});

type FetchOutcome =
  | { readonly kind: "ok"; readonly response: GuardedResponse }
  | { readonly kind: "blocked" }
  | { readonly kind: "failed" };

type JsonOutcome =
  | { readonly kind: "ok"; readonly value: unknown }
  | { readonly kind: "blocked" }
  | { readonly kind: "failed" };

export type DiscoveryOutcome =
  | {
      readonly ok: true;
      readonly server: AuthorizationServer;
      readonly resourceScopes: readonly string[];
    }
  | {
      readonly ok: false;
      readonly failure:
        DiscoveryFailure | "blocked_address" | "unreachable" | "malformed";
    };

@Injectable()
export class AuthorizationDiscoveryService {
  private readonly logger = new Logger(AuthorizationDiscoveryService.name);

  private readonly policy: EndpointPolicy;

  /**
   * Guard: loopback is reachable only outside production, where the in-repo demo
   * backend is the discovery target. In production the registrant's url is
   * forwarded verbatim, and a process that will fetch its own loopback on
   * request reaches admin surfaces no client can.
   */
  constructor(config: ConfigService<AppConfig, true>) {
    this.policy = {
      allowLoopback:
        config.get("environment", { infer: true }) !== "production",
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

    const metadata = await this.resourceMetadataUrl(mcpUrl);
    if (metadata.kind === "blocked") {
      return { ok: false, failure: "blocked_address" };
    }

    if (!isSecureEndpoint(metadata.url, this.policy)) {
      return { ok: false, failure: "insecure_transport" };
    }

    const document = await this.readJson(metadata.url);
    if (document.kind === "blocked") {
      return { ok: false, failure: "blocked_address" };
    }

    if (document.kind === "failed") {
      return { ok: false, failure: "unreachable" };
    }

    const resource = protectedResourceMetadataSchema.safeParse(document.value);
    if (!resource.success) {
      return { ok: false, failure: "malformed" };
    }

    if (!verifyProtectedResource(mcpUrl, resource.data)) {
      return { ok: false, failure: "resource_mismatch" };
    }

    const [issuer] = resource.data.authorization_servers;
    if (issuer === undefined || !isSecureEndpoint(issuer, this.policy)) {
      return { ok: false, failure: "insecure_transport" };
    }

    for (const candidate of authorizationServerMetadataUrls(issuer)) {
      const raw = await this.readJson(candidate);
      if (raw.kind === "blocked") {
        return { ok: false, failure: "blocked_address" };
      }

      if (raw.kind === "failed") {
        continue;
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
            resourceScopes: resource.data.scopes_supported ?? [],
          }
        : { ok: false, failure: verified.failure };
    }

    return { ok: false, failure: "unreachable" };
  }

  /**
   * Guard: each redirect hop is re-validated rather than followed. A server that
   * passed every check on its own address would otherwise answer `302` to one
   * that would not have, and the platform would follow it without another word.
   */
  private async follow(
    url: string,
    method: "GET" | "POST",
    headers: Record<string, string>,
    body?: string,
  ): Promise<FetchOutcome> {
    let target = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!isSecureEndpoint(target, this.policy)) {
        return { kind: "blocked" };
      }

      const outcome = await guardedRequest(
        {
          url: target,
          method,
          headers,
          body,
          timeoutMs: REQUEST_TIMEOUT_MS,
          maxBytes: MAX_METADATA_BYTES,
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
        return { kind: "failed" };
      }

      const { response } = outcome;
      if (
        response.status < 300 ||
        response.status >= 400 ||
        response.location === undefined
      ) {
        return { kind: "ok", response };
      }

      target = new URL(response.location, target).href;
    }

    return { kind: "failed" };
  }

  private async resourceMetadataUrl(
    mcpUrl: string,
  ): Promise<
    { readonly kind: "blocked" } | { readonly kind: "ok"; readonly url: string }
  > {
    const outcome = await this.follow(
      mcpUrl,
      "POST",
      {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      PROBE_BODY,
    );

    if (outcome.kind === "blocked") {
      return { kind: "blocked" };
    }

    const named =
      outcome.kind === "ok"
        ? resourceMetadataUrlFrom(outcome.response.challenge)
        : undefined;

    return { kind: "ok", url: named ?? defaultResourceMetadataUrl(mcpUrl) };
  }

  private async readJson(url: string): Promise<JsonOutcome> {
    const outcome = await this.follow(url, "GET", {
      accept: "application/json",
    });
    if (outcome.kind !== "ok") {
      return outcome;
    }

    if (outcome.response.status !== 200) {
      return { kind: "failed" };
    }

    try {
      return { kind: "ok", value: JSON.parse(outcome.response.body) };
    } catch {
      this.logger.debug(`metadata was not json (${url})`);

      return { kind: "failed" };
    }
  }
}
