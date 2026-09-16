import { authorizeInvocation } from "@chat/contracts/integration/authorize-invocation";
import type { InvocationDenialReason } from "@chat/contracts/integration/invocation-denial";
import type { ToolCallOutcome } from "@chat/contracts/integration/tool-result";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AppConfig } from "../config/configuration.ts";
import { ConnectionRepository } from "../connections/connection.repository.ts";
import { ConnectionTokenService } from "../connections/connection-token.service.ts";
import type { CatalogTool } from "../connections/integration-tool.repository.ts";
import { RemoteMcpSessionService } from "../connections/remote-mcp-session.service.ts";
import { callTool, type McpFailure } from "../connections/remote-mcp.client.ts";
import type { UserId } from "../db/ids.ts";
import { I18nService } from "../i18n/i18n.service.ts";
import type { Locale } from "@chat/contracts/common/locale";

const CALL_TIMEOUT_MS = 30_000;

const CALL_MAX_BYTES = 512 * 1024;

/**
 * Guard: a second ceiling, applied after parsing. The byte ceiling protects this
 * process from a server that streams without end; this one protects the context
 * window and the step budget from a server that answers with a legitimate but
 * enormous document.
 */
const MAX_OUTPUT_CHARS = 24_000;

const DENIAL_KEY: Record<InvocationDenialReason, string> = {
  connection_required: "chat:tools.denied.connection_required",
  connection_revoked: "chat:tools.denied.connection_revoked",
  insufficient_connection_scope: "chat:tools.denied.insufficient_scope",
  reauth_required: "chat:tools.denied.reauth_required",
};

const FAILURE_KEY: Record<McpFailure, string> = {
  unauthorized: "chat:tools.failed.unauthorized",
  blocked_address: "chat:tools.failed.blocked_address",
  unreachable: "chat:tools.failed.unreachable",
  too_large: "chat:tools.failed.too_large",
  malformed: "chat:tools.failed.malformed",
  rejected: "chat:tools.failed.rejected",
};

type Bearer =
  | { readonly kind: "token"; readonly accessToken: string | undefined }
  | { readonly kind: "refused"; readonly result: ToolInvocationResult };

export type ToolInvocationResult =
  | {
      readonly ok: true;
      readonly untrustedServerOutput: string;
      readonly serverReportedError: boolean;
    }
  | { readonly ok: false; readonly error: string };

@Injectable()
export class RemoteToolInvoker {
  private readonly logger = new Logger(RemoteToolInvoker.name);

  private readonly endpoint: { readonly allowLoopback: boolean };

  constructor(
    private readonly connections: ConnectionRepository,
    private readonly tokens: ConnectionTokenService,
    private readonly sessions: RemoteMcpSessionService,
    private readonly i18n: I18nService,
    @Inject(ConfigService) config: ConfigService<AppConfig, true>,
  ) {
    this.endpoint = {
      allowLoopback:
        config.get("environment", { infer: true }) !== "production",
    };
  }

  /**
   * Runs one remote tool on the reader's behalf.
   *
   * Guard: nothing here throws. Every refusal and every transport failure comes
   * back as a result the model can read, because a throw inside `execute`
   * becomes a tool error whose text the model cannot act on — and a turn that
   * ends in an unexplained failure is one the reader has to start again.
   *
   * Guard: `authorizeInvocation` runs before any credential is resolved and
   * before any network call, against rows loaded for this session's own user.
   * Filtering the catalog is not enforcement: the catalog was assembled a moment
   * earlier and the connection may have been revoked since.
   *
   * @param userId the subject of the trusted session, never a value the model produced
   * @param tool the catalog row the exposed name resolved to
   * @param args the arguments the model produced
   * @param locale the language the reader is reading
   * @returns what the tool returned, or why it did not run
   */
  async invoke(
    userId: UserId,
    tool: CatalogTool,
    args: unknown,
    locale: Locale,
  ): Promise<ToolInvocationResult> {
    const context = await this.connections.loadInvocationContext(
      userId,
      tool.integrationPublicId,
    );

    if (context === undefined) {
      return this.refuse("chat:tools.denied.connection_required", locale);
    }

    const decision = authorizeInvocation({
      sessionUserId: userId,
      toolName: tool.remoteName,
      integration: context.integration,
      connection: context.connection,
    });

    if (decision.outcome === "deny") {
      this.logger.warn(
        `refusing ${tool.remoteName} on ${tool.integrationPublicId}: ${decision.reason}/${decision.detail}`,
      );

      return this.refuse(DENIAL_KEY[decision.reason], locale);
    }

    const bearer = await this.bearerFor(userId, tool, locale);
    if (bearer.kind === "refused") {
      return bearer.result;
    }

    const session = this.sessions.sessionFor(
      userId,
      { publicId: tool.integrationPublicId, mcpUrl: tool.mcpUrl },
      bearer.accessToken,
      {
        endpoint: this.endpoint,
        timeoutMs: CALL_TIMEOUT_MS,
        maxBytes: CALL_MAX_BYTES,
      },
    );

    const called = await callTool(session, tool.remoteName, args);
    if (called.kind === "failed") {
      /**
       * Guard: a `401` from the resource is not the authorization server saying
       * no. Only `ConnectionTokenService` moves a connection to
       * `reauth_required`, so the session is dropped and the reader is told, and
       * nothing here rewrites the connection's state.
       */
      if (called.failure === "unauthorized") {
        this.sessions.release(userId, tool.integrationPublicId);
      }

      return this.refuse(FAILURE_KEY[called.failure], locale);
    }

    return this.render(called.value, locale);
  }

  private async bearerFor(
    userId: UserId,
    tool: CatalogTool,
    locale: Locale,
  ): Promise<Bearer> {
    if (tool.authMode === "none") {
      return { kind: "token", accessToken: undefined };
    }

    const token = await this.tokens.accessTokenFor(
      userId,
      tool.integrationPublicId,
    );

    switch (token.kind) {
      case "ok":
        return { kind: "token", accessToken: token.accessToken };
      case "open":
        return { kind: "token", accessToken: undefined };
      case "not_connected":
        return this.denied("chat:tools.denied.connection_required", locale);
      case "reauth_required":
        return this.denied("chat:tools.denied.reauth_required", locale);
      case "provider_unavailable":
        return this.denied("chat:tools.failed.unreachable", locale);
    }
  }

  /**
   * Guard: the field names the text as untrusted. Everything in it was written
   * by a server the reader pointed this product at, and the model reads it in
   * the same window as the reader's own words — the system instructions name
   * this field so an instruction hidden in a tool result stays data.
   */
  private render(outcome: ToolCallOutcome, locale: Locale): ToolInvocationResult {
    const parts = outcome.blocks.map((block) =>
      block.type === "text"
        ? block.text
        : this.i18n.t(`chat:tools.block.${block.type}`, {}, locale),
    );

    if (outcome.structuredContent !== undefined) {
      parts.push(JSON.stringify(outcome.structuredContent));
    }

    if (outcome.dropped > 0) {
      parts.push(
        this.i18n.t("chat:tools.dropped", { count: outcome.dropped }, locale),
      );
    }

    const joined = parts.join("\n");
    const text =
      joined.length > MAX_OUTPUT_CHARS
        ? `${joined.slice(0, MAX_OUTPUT_CHARS)}\n${this.i18n.t("chat:tools.truncated", {}, locale)}`
        : joined;

    return {
      ok: true,
      untrustedServerOutput: text,
      serverReportedError: outcome.isError,
    };
  }

  private refuse(key: string, locale: Locale): ToolInvocationResult {
    return { ok: false, error: this.i18n.t(key, {}, locale) };
  }

  private denied(key: string, locale: Locale): Bearer {
    return { kind: "refused", result: this.refuse(key, locale) };
  }
}
