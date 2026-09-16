import { Injectable, type OnModuleDestroy } from "@nestjs/common";

import type { UserId } from "../db/ids.ts";
import { McpSession, type McpTarget } from "./remote-mcp.client.ts";

const IDLE_MS = 5 * 60 * 1000;

const MAX_SESSIONS = 64;

interface Entry {
  readonly session: McpSession;
  readonly accessToken: string | undefined;
  touchedAt: number;
}

export interface SessionTarget {
  readonly publicId: string;
  readonly mcpUrl: string;
}

/**
 * Keeps one MCP session per reader and server, so a turn's second tool call does
 * not pay for a second handshake.
 */
@Injectable()
export class RemoteMcpSessionService implements OnModuleDestroy {
  private readonly sessions = new Map<string, Entry>();

  /**
   * Guard: the key names the reader as well as the server. A session carries the
   * reader's bearer and the server may bind state to the session id it issued;
   * keyed by integration alone, one reader's session would serve another's call.
   *
   * Guard: a changed token evicts rather than being sent on the old session. The
   * token changes when it was refreshed or the connection re-authorized, and a
   * session opened under the previous one has already been presented to the
   * server as somebody with different access.
   *
   * @param userId the subject of the trusted session
   * @param target the integration's public id and url
   * @param accessToken the bearer to present, or `undefined` for an open server
   * @param transport the endpoint policy and the ceilings for this call
   * @returns a session ready to carry `tools/call`
   */
  sessionFor(
    userId: UserId,
    target: SessionTarget,
    accessToken: string | undefined,
    transport: Omit<McpTarget, "url" | "accessToken">,
  ): McpSession {
    const key = `${userId}:${target.publicId}`;
    const now = Date.now();
    this.sweep(now);

    const existing = this.sessions.get(key);
    if (existing !== undefined && existing.accessToken === accessToken) {
      existing.touchedAt = now;

      return existing.session;
    }

    const session = new McpSession({
      url: target.mcpUrl,
      accessToken,
      ...transport,
    });
    this.sessions.set(key, { session, accessToken, touchedAt: now });

    return session;
  }

  release(userId: UserId, integrationPublicId: string): void {
    this.sessions.delete(`${userId}:${integrationPublicId}`);
  }

  onModuleDestroy(): void {
    this.sessions.clear();
  }

  /**
   * Guard: bounded by age and by count. A session holds only an id and a token,
   * but one entry per reader per server is unbounded in a process that never
   * restarts, and an id a server forgot long ago is worth less than the memory.
   */
  private sweep(now: number): void {
    for (const [key, entry] of this.sessions) {
      if (now - entry.touchedAt > IDLE_MS) {
        this.sessions.delete(key);
      }
    }

    while (this.sessions.size >= MAX_SESSIONS) {
      const [oldest] = [...this.sessions.entries()].sort(
        ([, left], [, right]) => left.touchedAt - right.touchedAt,
      );
      if (oldest === undefined) {
        return;
      }

      this.sessions.delete(oldest[0]);
    }
  }
}
