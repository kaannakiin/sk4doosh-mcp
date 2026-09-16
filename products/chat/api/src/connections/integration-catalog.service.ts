import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../config/configuration.ts";
import type { UserId } from "../db/ids.ts";
import { ConnectionTokenService } from "./connection-token.service.ts";
import {
  IntegrationToolRepository,
  type CatalogTool,
  type StaleIntegration,
} from "./integration-tool.repository.ts";
import { IntegrationRepository } from "./integration.repository.ts";
import { listTools } from "./remote-mcp.client.ts";

const STALE_AFTER_MS = 60 * 60 * 1000;

const LEASE_MS = 30_000;

const LIST_TIMEOUT_MS = 10_000;

const MAX_LIST_BYTES = 256 * 1024;

@Injectable()
export class IntegrationCatalogService {
  private readonly logger = new Logger(IntegrationCatalogService.name);

  private readonly endpoint: { readonly allowLoopback: boolean };

  constructor(
    private readonly tools: IntegrationToolRepository,
    private readonly integrations: IntegrationRepository,
    private readonly tokens: ConnectionTokenService,
    @Inject(ConfigService) config: ConfigService<AppConfig, true>,
  ) {
    this.endpoint = {
      allowLoopback:
        config.get("environment", { infer: true }) !== "production",
    };
  }

  /**
   * The tools a chat turn may offer, refreshing what has gone stale.
   *
   * Guard: only an integration whose list has never been read is waited for.
   * Everything else is re-read after the turn has already been served, because a
   * list at most an hour old is usable and a ten second timeout per server on
   * the critical path would let one unreachable server tax every message. A
   * server connected a moment ago is the exception — waiting a moment beats
   * being invisible for a whole turn.
   *
   * Guard: the background refresh is detached deliberately and swallows its own
   * failure. Nothing in the turn depends on it, and an unhandled rejection from
   * a server that went down would take the process with it.
   *
   * @param userId the subject of the trusted session
   * @returns every tool of every server this reader has connected
   */
  async catalogFor(userId: UserId): Promise<readonly CatalogTool[]> {
    const stale = await this.tools.staleFor(userId, STALE_AFTER_MS);

    await Promise.all(
      stale
        .filter(({ neverRead }) => neverRead)
        .map((integration) => this.refresh(userId, integration)),
    );

    const later = stale.filter(({ neverRead }) => !neverRead);
    if (later.length > 0) {
      void Promise.all(
        later.map((integration) => this.refresh(userId, integration)),
      );
    }

    return this.tools.catalogFor(userId);
  }

  private async refresh(
    userId: UserId,
    integration: StaleIntegration,
  ): Promise<void> {
    if (!(await this.tools.claimRefresh(integration.id, STALE_AFTER_MS, LEASE_MS))) {
      return;
    }

    let failed = true;
    try {
      const accessToken = await this.bearerFor(userId, integration);
      if (accessToken === undefined && integration.authMode === "oauth") {
        return;
      }

      const listed = await listTools({
        url: integration.mcpUrl,
        accessToken,
        endpoint: this.endpoint,
        timeoutMs: LIST_TIMEOUT_MS,
        maxBytes: MAX_LIST_BYTES,
      });

      if (listed.kind === "failed") {
        this.logger.warn(
          `could not re-read the tools of ${integration.publicId}: ${listed.failure}`,
        );

        return;
      }

      await this.integrations.replaceTools(integration.id, listed.value);
      failed = false;
    } catch (cause) {
      this.logger.error(
        `re-reading the tools of ${integration.publicId} threw: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      await this.tools.settleRefresh(integration.id, failed);
    }
  }

  private async bearerFor(
    userId: UserId,
    integration: StaleIntegration,
  ): Promise<string | undefined> {
    if (integration.authMode === "none") {
      return undefined;
    }

    const token = await this.tokens.accessTokenFor(userId, integration.publicId);

    return token.kind === "ok" ? token.accessToken : undefined;
  }
}
