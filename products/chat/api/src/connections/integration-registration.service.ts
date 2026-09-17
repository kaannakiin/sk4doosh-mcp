import type { DiscoveryFailure } from "@chat/contracts/integration/discovery-failure";
import {
  isSecureEndpoint,
  type EndpointPolicy,
} from "@chat/contracts/integration/discovery";
import type {
  CreateIntegration,
  IntegrationSummary,
  RegistrationFailure,
} from "@chat/contracts/integration/registration";
import type { RemoteTool } from "@chat/contracts/integration/remote-tool";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../config/configuration.ts";
import type { UserId } from "../db/ids.ts";
import { AuthorizationDiscoveryService } from "./authorization-discovery.service.ts";
import {
  IntegrationRepository,
  type IntegrationRecord,
} from "./integration.repository.ts";
import {
  IntegrationAuthorizationService,
  type NoClientReason,
} from "./integration-authorization.service.ts";
import { listTools, type McpFailure } from "./remote-mcp.client.ts";

const LIST_TIMEOUT_MS = 10_000;

const MAX_LIST_BYTES = 256 * 1024;

export type RegistrationResult =
  | { readonly kind: "created"; readonly integration: IntegrationSummary }
  | { readonly kind: "refused"; readonly failure: RegistrationFailure };

/**
 * Guard: every way discovery can end is named here. A new `DiscoveryFailure`
 * member stops the build rather than falling through to a default that tells the
 * reader their server is unreachable when it is something else.
 *
 * Guard: `unreachable` maps to `integration_not_mcp`, not to
 * `integration_unreachable`. This map is only consulted after the probe already
 * answered, so the server demonstrably responded — it simply does not publish
 * the authorization metadata. Reporting that as "did not answer" is the lie this
 * map exists to stop telling.
 */
const DISCOVERY_FAILURE: Record<DiscoveryFailure, RegistrationFailure> = {
  resource_mismatch: "integration_not_mcp",
  issuer_mismatch: "integration_not_mcp",
  insecure_transport: "integration_url_invalid",
  pkce_unsupported: "integration_auth_unsupported",
  blocked_address: "integration_unreachable",
  unreachable: "integration_not_mcp",
  malformed: "integration_not_mcp",
};

const NO_CLIENT_FAILURE: Record<NoClientReason, RegistrationFailure> = {
  registration_unsupported: "integration_auth_unsupported",
  registration_rejected: "integration_auth_unsupported",
  registration_unusable: "integration_auth_unsupported",
  registration_raced: "integration_auth_unsupported",
  redirect_uri_changed: "integration_auth_unsupported",
  client_secret_expired: "integration_auth_unsupported",
};

/**
 * Guard: `unauthorized` is absent on purpose. A server that guards its tools is
 * handled by falling through to the authorization-code path, not by being
 * refused, so it must never reach a map that would end the attempt.
 */
const LISTING_FAILURE: Record<
  Exclude<McpFailure, "unauthorized">,
  RegistrationFailure
> = {
  blocked_address: "integration_unreachable",
  unreachable: "integration_unreachable",
  too_large: "integration_too_large",
  malformed: "integration_not_mcp",
  rejected: "integration_not_mcp",
};

/**
 * Guard: only the fragment is dropped and only the host is lowercased. The path
 * and the query are the resource identifier RFC 8707 sends to the authorization
 * server and RFC 9728 compares against the resource metadata, so a normalizer
 * that touched them would make this platform ask for a token bound to a url the
 * resource never claimed.
 */
function normalize(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    url.hash = "";

    return url.href;
  } catch {
    return undefined;
  }
}

@Injectable()
export class IntegrationRegistrationService {
  private readonly logger = new Logger(IntegrationRegistrationService.name);

  private readonly policy: EndpointPolicy;

  constructor(
    private readonly integrations: IntegrationRepository,
    private readonly authorization: IntegrationAuthorizationService,
    private readonly discovery: AuthorizationDiscoveryService,
    @Inject(ConfigService) config: ConfigService<AppConfig, true>,
  ) {
    this.policy = {
      allowLoopback:
        config.get("environment", { infer: true }) !== "production",
    };
  }

  /**
   * Registers a server the reader named.
   *
   * Guard: what the endpoint answers decides which path runs. A server that
   * needs no credential has no protected resource metadata to read and no client
   * to register, and putting it through the authorization-code path reports it
   * as unreachable when it answered perfectly.
   *
   * @param userId the subject of the trusted session
   * @param input the url to register and an optional label
   * @returns the created integration, or why it was refused
   */
  async register(
    userId: UserId,
    input: CreateIntegration,
  ): Promise<RegistrationResult> {
    const mcpUrl = normalize(input.mcpUrl);
    if (mcpUrl === undefined || !isSecureEndpoint(mcpUrl, this.policy)) {
      return { kind: "refused", failure: "integration_url_invalid" };
    }

    const displayName = input.displayName ?? new URL(mcpUrl).host;

    /**
     * Guard: a row somebody is already using is refused before anything reaches
     * the network. The retry path below repairs a row it can delete, and this is
     * the one it must never see — and a second add of a server in use is not a
     * reason to make this process open a connection to it at all.
     */
    const existing = await this.integrations.findOwnedByUrl(userId, mcpUrl);
    if (existing?.inUse === true) {
      return { kind: "refused", failure: "integration_duplicate" };
    }

    const stale = existing?.record;
    const probe = await this.discovery.probeAuthorization(mcpUrl);

    switch (probe.kind) {
      case "blocked":
      case "unanswered":
        return { kind: "refused", failure: "integration_unreachable" };

      case "open":
        return this.registerOpen(userId, mcpUrl, displayName, stale);

      case "challenged":
        return this.registerOauth(userId, mcpUrl, displayName, stale);
    }
  }

  /**
   * Guard: the tools are listed before anything is written, and listing them is
   * what proves the server is open. A server that answers `initialize` to
   * anybody while guarding its tools is not open, and the attempt falls through
   * to the authorization-code path rather than storing an integration that can
   * never be used.
   */
  private async registerOpen(
    userId: UserId,
    mcpUrl: string,
    displayName: string,
    stale: IntegrationRecord | undefined,
  ): Promise<RegistrationResult> {
    const listed = await listTools({
      url: mcpUrl,
      accessToken: undefined,
      endpoint: this.policy,
      timeoutMs: LIST_TIMEOUT_MS,
      maxBytes: MAX_LIST_BYTES,
    });

    if (listed.kind === "failed") {
      if (listed.failure === "unauthorized") {
        return this.registerOauth(userId, mcpUrl, displayName, stale);
      }

      return { kind: "refused", failure: LISTING_FAILURE[listed.failure] };
    }

    /**
     * Guard: the row left by an earlier attempt goes before the open one is
     * written, because the open write is a single transaction and has no way to
     * merge into a row shaped by the other path. Removing it costs nothing — a
     * row nobody has connected to carries no grant.
     */
    if (stale !== undefined) {
      await this.integrations.removeOwned(userId, stale.publicId);
    }

    const created = await this.integrations.createOpen({
      ownerId: BigInt(userId),
      mcpUrl,
      displayName,
      tools: listed.value,
    });

    if (created === "duplicate" || stale !== undefined) {
      return { kind: "refused", failure: "integration_duplicate" };
    }

    return {
      kind: "created",
      integration: this.summarize(created, displayName, listed.value),
    };
  }

  /**
   * Guard: a row an earlier attempt left behind is completed rather than
   * refused. The row is written before this process can reach the provider, so a
   * crash in between leaves one that never got a client — and answering the
   * owner's next attempt with "already added" would hide both the real reason
   * and the row they cannot complete.
   */
  private async registerOauth(
    userId: UserId,
    mcpUrl: string,
    displayName: string,
    stale: IntegrationRecord | undefined,
  ): Promise<RegistrationResult> {
    const created =
      stale ??
      (await this.integrations.create({
        ownerId: BigInt(userId),
        mcpUrl,
        displayName,
      }));

    if (created === "duplicate") {
      return { kind: "refused", failure: "integration_duplicate" };
    }

    const subject = created;
    const prepared = await this.authorization.ensureClient(subject);
    if (prepared.kind !== "ready") {
      this.logger.warn(
        `discarding ${subject.publicId}: ${prepared.kind === "refused" ? prepared.failure : prepared.detail}`,
      );
      await this.integrations.removeOwned(userId, subject.publicId);

      return {
        kind: "refused",
        failure:
          prepared.kind === "refused"
            ? DISCOVERY_FAILURE[prepared.failure]
            : NO_CLIENT_FAILURE[prepared.reason],
      };
    }

    return stale === undefined
      ? {
          kind: "created",
          integration: this.summarize(subject, displayName, []),
        }
      : { kind: "refused", failure: "integration_duplicate" };
  }

  /**
   * Guard: the mode is read off the row that was written, never inferred from
   * whether tools came back. An open server that publishes no tools is still an
   * open server, and guessing from the list would tell the reader to authorize
   * against an authorization server that does not exist.
   */
  private summarize(
    created: IntegrationRecord,
    displayName: string,
    tools: readonly RemoteTool[],
  ): IntegrationSummary {
    const open = created.authMode === "none";

    return {
      id: created.publicId,
      displayName,
      mcpUrl: created.mcpUrl,
      origin: "user",
      authMode: created.authMode,
      toolCount: tools.length,
      connection: open
        ? {
            status: "active",
            authorizedAt: new Date().toISOString(),
            lastUsedAt: null,
          }
        : null,
    };
  }
}
