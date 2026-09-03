import { Inject, Injectable } from "@nestjs/common";
import {
  createCallerScope,
  deriveCallerScopeKey,
  digestInput,
  type CacheTag,
  type CallerScope,
  type SkMcpCache,
} from "@sk-mcp/core";
import { extensionTokens } from "./extension-points.js";
import { SK_MCP_OPTIONS, SkMcpOptions, type OuterRequest } from "./options.js";

export interface CallerScopeResolver {
  resolve(outer: OuterRequest | undefined): CallerScope;
}

@Injectable()
export class CarrierHashCallerScopeResolver implements CallerScopeResolver {
  constructor(@Inject(SK_MCP_OPTIONS) private readonly options: SkMcpOptions) {}

  resolve(outer: OuterRequest | undefined): CallerScope {
    const carriers = [...this.options.identity.carriers];
    const digest = digestInput(carriers, (name) => outer?.headers[name]);
    return createCallerScope(deriveCallerScopeKey(digest));
  }
}

export const SK_MCP_CACHE_INVALIDATOR = Symbol("SK_MCP_CACHE_INVALIDATOR");

@Injectable()
export class SkMcpCacheInvalidator {
  constructor(
    @Inject(extensionTokens.cache) private readonly cache: SkMcpCache,
  ) {}

  invalidateCaller(scope: CallerScope): Promise<void> {
    return this.cache.removeScope(scope.key);
  }

  invalidateTag(tag: CacheTag): Promise<void> {
    return this.cache.removeTag(tag);
  }

  invalidateAll(): Promise<void> {
    return this.cache.clear();
  }
}
