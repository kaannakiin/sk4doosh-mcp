import type { CallerScope, CallerScopeKey, CacheTag } from "./caller-scope.js";
import type { CacheKey, SkMcpCache } from "./cache.js";

export interface MemorySkMcpCacheOptions {
  readonly lifetimeMs: number;
  readonly maxCallers: number;
  readonly now?: () => number;
}

interface ScopeEntry {
  expires: number;
  tags: Set<CacheTag>;
  values: Map<string, string>;
  lastUsed: number;
}

function valueKey(key: CacheKey): string {
  return key.subkey === undefined ? key.kind : `${key.kind}:${key.subkey}`;
}

export class MemorySkMcpCache implements SkMcpCache {
  private readonly lifetimeMs: number;
  private readonly maxCallers: number;
  private readonly now: () => number;
  private scopes = new Map<CallerScopeKey, ScopeEntry>();
  private tagIndex = new Map<CacheTag, Set<CallerScopeKey>>();

  constructor(options: MemorySkMcpCacheOptions) {
    this.lifetimeMs = options.lifetimeMs;
    this.maxCallers = options.maxCallers;
    this.now = options.now ?? Date.now;
  }

  async get(key: CacheKey): Promise<string | undefined> {
    if (this.lifetimeMs <= 0) {
      return undefined;
    }
    const entry = this.touch(key.scope.key, this.now());
    return entry?.values.get(valueKey(key));
  }

  async set(key: CacheKey, value: string): Promise<void> {
    if (this.lifetimeMs <= 0) {
      return;
    }
    const now = this.now();
    const entry = this.touch(key.scope.key, now) ?? this.admit(key.scope, now);
    for (const tag of key.scope.tags) {
      if (!entry.tags.has(tag)) {
        entry.tags.add(tag);
        this.indexTag(tag, key.scope.key);
      }
    }
    entry.values.set(valueKey(key), value);
  }

  async removeScope(scopeKey: CallerScopeKey): Promise<void> {
    const entry = this.scopes.get(scopeKey);
    if (entry !== undefined) {
      this.evict(scopeKey, entry);
    }
  }

  async removeTag(tag: CacheTag): Promise<void> {
    const scopeKeys = this.tagIndex.get(tag);
    if (scopeKeys === undefined) {
      return;
    }
    for (const scopeKey of [...scopeKeys]) {
      const entry = this.scopes.get(scopeKey);
      if (entry !== undefined) {
        this.evict(scopeKey, entry);
      }
    }
    this.tagIndex.delete(tag);
  }

  async clear(): Promise<void> {
    this.scopes = new Map();
    this.tagIndex = new Map();
  }

  private touch(scopeKey: CallerScopeKey, now: number): ScopeEntry | undefined {
    const entry = this.scopes.get(scopeKey);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expires <= now) {
      this.evict(scopeKey, entry);
      return undefined;
    }
    this.scopes.delete(scopeKey);
    entry.lastUsed = now;
    this.scopes.set(scopeKey, entry);
    return entry;
  }

  private admit(scope: CallerScope, now: number): ScopeEntry {
    if (this.scopes.size >= this.maxCallers) {
      const lru = this.scopes.entries().next().value;
      if (lru !== undefined) {
        this.evict(lru[0], lru[1]);
      }
    }
    const entry: ScopeEntry = {
      expires: now + this.lifetimeMs,
      tags: new Set(),
      values: new Map(),
      lastUsed: now,
    };
    this.scopes.set(scope.key, entry);
    return entry;
  }

  private evict(scopeKey: CallerScopeKey, entry: ScopeEntry): void {
    this.scopes.delete(scopeKey);
    for (const tag of entry.tags) {
      const scopeKeys = this.tagIndex.get(tag);
      if (scopeKeys === undefined) {
        continue;
      }
      scopeKeys.delete(scopeKey);
      if (scopeKeys.size === 0) {
        this.tagIndex.delete(tag);
      }
    }
  }

  private indexTag(tag: CacheTag, scopeKey: CallerScopeKey): void {
    let scopeKeys = this.tagIndex.get(tag);
    if (scopeKeys === undefined) {
      scopeKeys = new Set();
      this.tagIndex.set(tag, scopeKeys);
    }
    scopeKeys.add(scopeKey);
  }
}
