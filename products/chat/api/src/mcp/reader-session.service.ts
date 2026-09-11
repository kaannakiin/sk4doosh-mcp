import type { ReaderFamily } from "@chat/contracts/attachment/media-type";
import type { SessionId } from "@chat/contracts/chat/session";
import type { Readiness } from "@chat/contracts/http/health";
import { EXCEL_TOOL_SCHEMAS } from "@chat/contracts/tools/excel/catalog";
import { XML_TOOL_SCHEMAS } from "@chat/contracts/tools/xml/catalog";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ToolSet } from "ai";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AttachmentStoreService } from "../attachments/attachment-store.service.ts";
import type {
  AppConfig,
  ReaderConfig,
  SessionConfig,
} from "../config/configuration.ts";
import { readerCommandFor } from "./reader-command.ts";

const SWEEP_INTERVAL_MS = 60_000;

const SCHEMAS_BY_FAMILY = {
  workbook: EXCEL_TOOL_SCHEMAS,
  document: XML_TOOL_SCHEMAS,
} as const;

@Injectable()
export class ReaderSessionService implements OnModuleDestroy {
  private readonly logger = new Logger(ReaderSessionService.name);

  private readonly clients = new Map<string, Promise<MCPClient>>();

  private readonly readiness = new Map<ReaderFamily, Readiness>();

  private readonly readers: ReaderConfig;

  private readonly sessions: SessionConfig;

  private readonly sweeper: NodeJS.Timeout;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly store: AttachmentStoreService,
  ) {
    this.readers = config.get("readers", { infer: true });
    this.sessions = config.get("sessions", { infer: true });
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.sweeper.unref();
  }

  /**
   * The tool set a chat turn may use. Only the families the session actually
   * holds a file for are connected: a session with one CSV never pays for an
   * XML reader process, and never offers the model four tools it cannot use.
   */
  async toolsFor(session: SessionId): Promise<ToolSet> {
    const families = this.store.familiesFor(session);
    if (families.size === 0) {
      return {};
    }

    await this.evictOverflow(session);

    const sets = await Promise.all(
      [...families].map((family) => this.toolsOf(session, family)),
    );

    return Object.assign({}, ...sets) as ToolSet;
  }

  statusOf(family: ReaderFamily): Readiness {
    if (this.commandOf(family) === undefined) {
      return "unconfigured";
    }

    return this.readiness.get(family) ?? "ready";
  }

  /**
   * Spawns a reader against a throwaway root and lists its tools, so `/health`
   * distinguishes a command that is missing from one that starts and speaks
   * MCP. A `dist` that was never built is the common case and it is silent
   * otherwise: the tools simply never appear.
   */
  async probe(family: ReaderFamily): Promise<Readiness> {
    const raw = this.commandOf(family);
    if (raw === undefined) {
      return "unconfigured";
    }

    const root = await mkdtemp(join(tmpdir(), "chat-reader-probe-"));
    try {
      const client = await this.connect(raw, root);
      try {
        await client.listTools();
        this.readiness.set(family, "ready");

        return "ready";
      } finally {
        await client.close();
      }
    } catch (cause) {
      this.logger.warn(`reader probe failed (${family}): ${describe(cause)}`);
      this.readiness.set(family, "failed");

      return "failed";
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  async release(session: SessionId): Promise<void> {
    const prefix = `${session}:`;
    for (const [key, pending] of [...this.clients.entries()]) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      this.clients.delete(key);
      await closeQuietly(pending);
    }
  }

  async onModuleDestroy(): Promise<void> {
    clearInterval(this.sweeper);
    const pending = [...this.clients.values()];
    this.clients.clear();
    await Promise.all(pending.map(closeQuietly));
  }

  private async toolsOf(
    session: SessionId,
    family: ReaderFamily,
  ): Promise<ToolSet> {
    const raw = this.commandOf(family);
    if (raw === undefined) {
      return {};
    }

    const key = `${session}:${family}`;
    const existing = this.clients.get(key);
    const pending =
      existing ??
      (async () => {
        const root = this.store.rootFor(session);
        await mkdir(root, { recursive: true });

        return this.connect(raw, root);
      })();
    this.clients.set(key, pending);

    try {
      const client = await pending;
      this.readiness.set(family, "ready");

      return (await client.tools({
        schemas: SCHEMAS_BY_FAMILY[family],
      })) as ToolSet;
    } catch (cause) {
      this.clients.delete(key);
      this.readiness.set(family, "failed");
      this.logger.warn(`reader unavailable (${family}): ${describe(cause)}`);

      return {};
    }
  }

  private async connect(raw: string, root: string): Promise<MCPClient> {
    const parsed = readerCommandFor(raw, root);
    if (parsed === undefined) {
      throw new Error("empty reader command");
    }

    return createMCPClient({
      transport: new Experimental_StdioMCPTransport({
        command: parsed.command,
        args: parsed.args,
        stderr: "inherit",
      }),
    });
  }

  private commandOf(family: ReaderFamily): string | undefined {
    return family === "workbook"
      ? this.readers.workbookCommand
      : this.readers.documentCommand;
  }

  private async evictOverflow(active: SessionId): Promise<void> {
    const live = new Set(
      [...this.clients.keys()].map((key) => key.slice(0, key.lastIndexOf(":"))),
    );
    live.add(active);
    if (live.size <= this.sessions.maxSessions) {
      return;
    }

    const evictable = this.store
      .idleSessions(0)
      .filter((session) => session !== active && live.has(session));

    for (const session of evictable.slice(
      0,
      live.size - this.sessions.maxSessions,
    )) {
      await this.release(session);
      await this.store.dispose(session);
    }
  }

  private async sweep(): Promise<void> {
    for (const session of this.store.idleSessions(this.sessions.idleTtlMs)) {
      await this.release(session);
      await this.store.dispose(session);
    }
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function closeQuietly(pending: Promise<MCPClient>): Promise<void> {
  try {
    await (await pending).close();
  } catch {
    return;
  }
}
