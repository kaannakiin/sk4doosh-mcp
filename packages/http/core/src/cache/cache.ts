import type { CallerScope, CallerScopeKey, CacheTag } from "./caller-scope.js";

export type CacheKind = "facts" | "probe";

export interface CacheKey {
  readonly scope: CallerScope;
  readonly kind: CacheKind;
  readonly subkey?: string;
}

export type FlatCacheKey =
  | `liaiso:v1:${string}:${CacheKind}`
  | `liaiso:v1:${string}:${CacheKind}:${string}`;

export function flattenCacheKey(key: CacheKey): FlatCacheKey {
  return key.subkey === undefined
    ? `liaiso:v1:${key.scope.key}:${key.kind}`
    : `liaiso:v1:${key.scope.key}:${key.kind}:${key.subkey}`;
}

export interface LiaisoCache {
  get(key: CacheKey): Promise<string | undefined>;
  set(key: CacheKey, value: string): Promise<void>;
  removeScope(scopeKey: CallerScopeKey): Promise<void>;
  removeTag(tag: CacheTag): Promise<void>;
  clear(): Promise<void>;
}
