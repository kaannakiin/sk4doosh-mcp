import type { InjectionToken, Provider, Type } from "@nestjs/common";
import type { SkMcpCache } from "@sk-mcp/core";
import type { CallerScopeResolver } from "./cache.js";
import type { InvokeResultMapper } from "./invoke-result-mapper.js";
import type { SkMcpSessionStore } from "./transport/session-store.js";

export interface ExtensionPoints {
  cache: SkMcpCache;
  callerScopeResolver: CallerScopeResolver;
  invokeResultMapper: InvokeResultMapper;
  sessionStore: SkMcpSessionStore;
}

export const extensionTokens = {
  cache: Symbol("SK_MCP_CACHE"),
  callerScopeResolver: Symbol("SK_MCP_CALLER_SCOPE_RESOLVER"),
  invokeResultMapper: Symbol("SK_MCP_INVOKE_RESULT_MAPPER"),
  sessionStore: Symbol("SK_MCP_SESSION_STORE"),
} as const satisfies { readonly [K in keyof ExtensionPoints]: symbol };

export type OverrideProvider<T> =
  | { useClass: Type<T> }
  | {
      useFactory: (...args: never[]) => T | Promise<T>;
      inject?: InjectionToken[];
    }
  | { useValue: T };

export type ExtensionOverrides = Partial<{
  [K in keyof ExtensionPoints]: OverrideProvider<ExtensionPoints[K]>;
}>;

export function toProviders(overrides?: ExtensionOverrides): Provider[] {
  if (overrides === undefined) {
    return [];
  }
  const providers: Provider[] = [];
  for (const key of Object.keys(extensionTokens) as (keyof ExtensionPoints)[]) {
    const override = overrides[key];
    if (override === undefined) {
      continue;
    }
    const token = extensionTokens[key];
    if ("useValue" in override) {
      providers.push({ provide: token, useValue: override.useValue });
    } else if ("useFactory" in override) {
      providers.push({
        provide: token,
        useFactory: override.useFactory,
        inject: override.inject ?? [],
      });
    } else {
      providers.push({ provide: token, useClass: override.useClass });
    }
  }
  return providers;
}
