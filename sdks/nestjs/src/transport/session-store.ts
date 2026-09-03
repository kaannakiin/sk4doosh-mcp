import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export type SkMcpSessionMode = "stateless" | "stateful";

export interface SkMcpTransportOptions {
  sessionMode: SkMcpSessionMode;
}

export interface SkMcpSessionEntry {
  readonly server: McpServer;
  readonly transport: StreamableHTTPServerTransport;
}

export interface SkMcpSessionStore {
  get(sessionId: string): SkMcpSessionEntry | undefined;
  set(sessionId: string, entry: SkMcpSessionEntry): void;
  delete(sessionId: string): void;
  values(): IterableIterator<SkMcpSessionEntry>;
}

interface StoredEntry extends SkMcpSessionEntry {
  lastActiveAt: number;
}

export interface InMemorySessionStoreOptions {
  idleTimeoutMs?: number;
  maxIdleSessions?: number;
  now?: () => number;
}

const defaultIdleTimeoutMs = 2 * 60 * 60 * 1000;
const defaultMaxIdleSessions = 10_000;

export class InMemorySessionStore implements SkMcpSessionStore {
  private readonly idleTimeoutMs: number;
  private readonly maxIdleSessions: number;
  private readonly now: () => number;
  private readonly sessions = new Map<string, StoredEntry>();

  constructor(options: InMemorySessionStoreOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? defaultIdleTimeoutMs;
    this.maxIdleSessions = options.maxIdleSessions ?? defaultMaxIdleSessions;
    this.now = options.now ?? Date.now;
  }

  get(sessionId: string): SkMcpSessionEntry | undefined {
    const entry = this.sessions.get(sessionId);
    if (entry === undefined) {
      return undefined;
    }
    const now = this.now();
    if (now - entry.lastActiveAt > this.idleTimeoutMs) {
      this.evict(sessionId, entry);
      return undefined;
    }
    entry.lastActiveAt = now;
    return entry;
  }

  set(sessionId: string, entry: SkMcpSessionEntry): void {
    if (
      !this.sessions.has(sessionId) &&
      this.sessions.size >= this.maxIdleSessions
    ) {
      this.evictOldest();
    }
    this.sessions.set(sessionId, { ...entry, lastActiveAt: this.now() });
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  values(): IterableIterator<SkMcpSessionEntry> {
    return this.sessions.values();
  }

  private evictOldest(): void {
    let oldestId: string | undefined;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [id, entry] of this.sessions) {
      if (entry.lastActiveAt < oldestAt) {
        oldestAt = entry.lastActiveAt;
        oldestId = id;
      }
    }
    if (oldestId !== undefined) {
      const entry = this.sessions.get(oldestId);
      if (entry !== undefined) {
        this.evict(oldestId, entry);
      }
    }
  }

  private evict(sessionId: string, entry: StoredEntry): void {
    this.sessions.delete(sessionId);
    void entry.transport.close().catch(() => undefined);
    void entry.server.close().catch(() => undefined);
  }
}
