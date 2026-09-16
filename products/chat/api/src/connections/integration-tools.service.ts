import type { IntegrationId } from "@chat/contracts/integration/integration";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../config/configuration.ts";
import type { UserId } from "../db/ids.ts";
import { ConnectionTokenService } from "./connection-token.service.ts";
import { IntegrationRepository } from "./integration.repository.ts";
import { IntegrationAuthorizationService } from "./integration-authorization.service.ts";
import {
  listTools,
  type McpOutcome,
  type RemoteToolList,
} from "./remote-mcp.client.ts";

const LIST_TIMEOUT_MS = 10_000;

const MAX_LIST_BYTES = 256 * 1024;

export type ToolRefreshOutcome =
  | { readonly kind: "refreshed"; readonly toolCount: number }
  | { readonly kind: "upgraded" }
  | { readonly kind: "not_found" }
  | { readonly kind: "not_connected" }
  | { readonly kind: "reauth_required" }
  | { readonly kind: "provider_unavailable" };

@Injectable()
export class IntegrationToolsService {
  private readonly logger = new Logger(IntegrationToolsService.name);

  private readonly endpoint: { readonly allowLoopback: boolean };

  constructor(
    private readonly integrations: IntegrationRepository,
    private readonly tokens: ConnectionTokenService,
    private readonly authorization: IntegrationAuthorizationService,
    @Inject(ConfigService) config: ConfigService<AppConfig, true>,
  ) {
    this.endpoint = {
      allowLoopback:
        config.get("environment", { infer: true }) !== "production",
    };
  }

  /**
   * Re-reads what a server offers, and notices when it has started asking for a
   * token.
   *
   * Guard: the tool list is otherwise written once, when the integration is
   * registered or authorized. A server that adds, renames or withdraws a tool
   * would go on being resolved against a list that no longer describes it.
   *
   * @param userId the subject of the trusted session
   * @param integrationId the integration to re-read
   * @returns what the server said, or what it now needs
   */
  async refresh(
    userId: UserId,
    integrationId: IntegrationId,
  ): Promise<ToolRefreshOutcome> {
    const integration = await this.integrations.loadVisible(
      userId,
      integrationId,
    );

    if (integration === undefined) {
      return { kind: "not_found" };
    }

    const listed =
      integration.authMode === "none"
        ? await this.list(integration.mcpUrl, undefined)
        : await this.listWithToken(userId, integrationId, integration.mcpUrl);

    if (listed === undefined) {
      return { kind: "reauth_required" };
    }

    if (listed.kind === "failed") {
      /**
       * Guard: a server that has started refusing an open integration is moved
       * onto the authorization-code path rather than reported broken. The reader
       * keeps the integration and its history and is asked to authorize once.
       */
      if (listed.failure === "unauthorized") {
        return integration.authMode === "none"
          ? this.upgrade(integration)
          : { kind: "reauth_required" };
      }

      return { kind: "provider_unavailable" };
    }

    await this.integrations.replaceTools(integration.id, listed.value);

    return { kind: "refreshed", toolCount: listed.value.length };
  }

  private list(
    mcpUrl: string,
    accessToken: string | undefined,
  ): Promise<McpOutcome<RemoteToolList>> {
    return listTools({
      url: mcpUrl,
      accessToken,
      endpoint: this.endpoint,
      timeoutMs: LIST_TIMEOUT_MS,
      maxBytes: MAX_LIST_BYTES,
    });
  }

  /**
   * Guard: `undefined` means there is no token to present and no point asking
   * the server, which is a different answer from the server refusing one.
   */
  private async listWithToken(
    userId: UserId,
    integrationId: IntegrationId,
    mcpUrl: string,
  ): Promise<McpOutcome<RemoteToolList> | undefined> {
    const token = await this.tokens.accessTokenFor(userId, integrationId);

    return token.kind === "ok"
      ? this.list(mcpUrl, token.accessToken)
      : undefined;
  }

  /**
   * Guard: the client is registered before the mode is flipped. An integration
   * moved to `oauth` with no client behind it can neither be used openly nor
   * authorized, so a failed discovery leaves the row exactly as it was.
   */
  private async upgrade(integration: {
    readonly id: bigint;
    readonly publicId: string;
    readonly mcpUrl: string;
  }): Promise<ToolRefreshOutcome> {
    const prepared = await this.authorization.ensureClient(integration);

    if (prepared.kind !== "ready") {
      this.logger.warn(
        `${integration.publicId} began refusing anonymous calls but could not be authorized: ${prepared.kind === "refused" ? prepared.failure : prepared.reason}`,
      );

      return { kind: "provider_unavailable" };
    }

    await this.integrations.upgradeToOauth(integration.id);

    return { kind: "upgraded" };
  }
}
