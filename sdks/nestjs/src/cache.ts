import { Inject, Injectable } from "@nestjs/common";
import {
  createCallerScope,
  deriveCallerScopeKey,
  digestInput,
  type CacheTag,
  type CallerScope,
  type LiaisoCache,
} from "@liaiso/core";
import { extensionTokens } from "./extension-points.js";
import { LIAISO_OPTIONS, LiaisoOptions, type OuterRequest } from "./options.js";

export interface CallerScopeResolver {
  resolve(outer: OuterRequest | undefined): CallerScope;
}

@Injectable()
export class CarrierHashCallerScopeResolver implements CallerScopeResolver {
  constructor(
    @Inject(LIAISO_OPTIONS) private readonly options: LiaisoOptions,
  ) {}

  resolve(outer: OuterRequest | undefined): CallerScope {
    const carriers = [...this.options.identity.carriers];
    const digest = digestInput(carriers, (name) => outer?.headers[name]);
    return createCallerScope(deriveCallerScopeKey(digest));
  }
}

export const LIAISO_CACHE_INVALIDATOR = Symbol("LIAISO_CACHE_INVALIDATOR");

@Injectable()
export class LiaisoCacheInvalidator {
  constructor(
    @Inject(extensionTokens.cache) private readonly cache: LiaisoCache,
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
