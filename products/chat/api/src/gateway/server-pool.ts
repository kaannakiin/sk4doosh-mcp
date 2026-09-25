import type { SessionId } from "@chat/contracts/chat/session";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";

import { CodexWorkspaceService } from "../codex/codex-workspace.service.ts";
import { errorMessage } from "../common/utils/error.utils.ts";

const SWEEP_INTERVAL_MS = 60_000;

/**
 * Guard: shorter than the workspace's own idle ttl (30 minutes in
 * `CodexWorkspaceService`), so an idle conversation's servers are closed by this
 * sweep before that one removes the directory they are rooted at.
 */
const IDLE_MS = 10 * 60 * 1000;

export interface ServerSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

interface Pooled {
  readonly client: Promise<MCPClient>;
  lastUsed: number;
}

/**
 * The stdio MCP servers the agent gateway runs on a conversation's behalf,
 * each rooted at that conversation's workspace.
 */
@Injectable()
export class AgentServerPool implements OnModuleDestroy {
  private readonly logger = new Logger(AgentServerPool.name);

  private readonly clients = new Map<string, Pooled>();

  private readonly sweeper: NodeJS.Timeout;

  constructor(workspaces: CodexWorkspaceService) {
    workspaces.onRelease((session) => this.release(session));
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.sweeper.unref();
  }

  /**
   * The conversation's client for one server, spawned on first use.
   *
   * Guard: a client whose name shares the family but not the variant is closed
   * first. The worker's model is part of its name, and a conversation that
   * switched models would otherwise keep a process per model it ever used.
   *
   * @param session the conversation the server is rooted for
   * @param family what the server is, shared by all its variants
   * @param variant what distinguishes this spawn, such as the worker's model
   * @param spec how to start it
   * @returns the connected client
   */
  async clientFor(
    session: SessionId,
    family: string,
    variant: string,
    spec: ServerSpec,
  ): Promise<MCPClient> {
    const prefix = `${session}:${family}:`;
    const key = `${prefix}${variant}`;
    for (const stale of [...this.clients.keys()]) {
      if (stale.startsWith(prefix) && stale !== key) {
        await this.close(stale);
      }
    }

    const existing = this.clients.get(key);
    if (existing !== undefined) {
      existing.lastUsed = Date.now();

      return existing.client;
    }

    const client = createMCPClient({
      transport: new Experimental_StdioMCPTransport({
        command: spec.command,
        args: [...spec.args],
        env: { ...spec.env },
        stderr: "inherit",
      }),
    });
    this.clients.set(key, { client, lastUsed: Date.now() });

    try {
      return await client;
    } catch (cause) {
      this.clients.delete(key);
      this.logger.warn(`${family} did not start: ${errorMessage(cause)}`);
      throw cause;
    }
  }

  async release(session: SessionId): Promise<void> {
    const prefix = `${session}:`;
    for (const key of [...this.clients.keys()]) {
      if (key.startsWith(prefix)) {
        await this.close(key);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.sweeper);
    await Promise.all([...this.clients.keys()].map((key) => this.close(key)));
  }

  private async sweep(): Promise<void> {
    const cutoff = Date.now() - IDLE_MS;
    for (const [key, pooled] of [...this.clients.entries()]) {
      if (pooled.lastUsed <= cutoff) {
        await this.close(key);
      }
    }
  }

  private async close(key: string): Promise<void> {
    const pooled = this.clients.get(key);
    this.clients.delete(key);
    try {
      await (await pooled?.client)?.close();
    } catch {
      return;
    }
  }
}
