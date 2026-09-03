import type { CallerScope, CallerScopeKey, CacheTag } from "./caller-scope.js";

export type CacheKind = "facts" | "probe";

export interface CacheKey {
  readonly scope: CallerScope;
  readonly kind: CacheKind;
  readonly subkey?: string;
}

export type FlatCacheKey =
  | `skmcp:v1:${string}:${CacheKind}`
  | `skmcp:v1:${string}:${CacheKind}:${string}`;

export function flattenCacheKey(key: CacheKey): FlatCacheKey {
  return key.subkey === undefined
    ? `skmcp:v1:${key.scope.key}:${key.kind}`
    : `skmcp:v1:${key.scope.key}:${key.kind}:${key.subkey}`;
}

export interface SkMcpCache {
  get(key: CacheKey): Promise<string | undefined>;
  set(key: CacheKey, value: string): Promise<void>;
  removeScope(scopeKey: CallerScopeKey): Promise<void>;
  removeTag(tag: CacheTag): Promise<void>;
  clear(): Promise<void>;
}
