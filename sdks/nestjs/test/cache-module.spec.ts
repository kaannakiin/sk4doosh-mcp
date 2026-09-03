import "reflect-metadata";
import { Module, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  createCallerScope,
  MemorySkMcpCache,
  type SkMcpCache,
} from "@sk-mcp/core";
import {
  extensionTokens,
  SkMcpCacheInvalidator,
  SkMcpModule,
  SkMcpOptions,
  SK_MCP_CACHE_INVALIDATOR,
  SK_MCP_OPTIONS,
  type CallerScopeResolver,
} from "../src/index.js";
import { createApp, type TestApp } from "./hosts.js";

let current: TestApp | undefined;
let currentApp: INestApplication | undefined;

afterEach(async () => {
  await current?.close();
  current = undefined;
  await currentApp?.close();
  currentApp = undefined;
});

class RecordingCache implements SkMcpCache {
  readonly removedScopes: string[] = [];
  readonly removedTags: string[] = [];
  cleared = 0;

  async get(): Promise<string | undefined> {
    return undefined;
  }

  async set(): Promise<void> {}

  async removeScope(scopeKey: string): Promise<void> {
    this.removedScopes.push(scopeKey);
  }

  async removeTag(tag: string): Promise<void> {
    this.removedTags.push(tag);
  }

  async clear(): Promise<void> {
    this.cleared += 1;
  }
}

describe("cache extension points", () => {
  it("N1: the default cache is MemorySkMcpCache, sized from options.cache", async () => {
    current = await createApp((options) => {
      options.cache.lifetimeMs = 1234;
      options.cache.maxCallers = 7;
    });
    const cache = current.app.get<SkMcpCache>(extensionTokens.cache);
    expect(cache).toBeInstanceOf(MemorySkMcpCache);
  });

  it("N2: overrides.cache accepts useClass, useFactory, and useValue", async () => {
    const useClassApp = await createApp(undefined, {
      cache: { useClass: RecordingCache },
    });
    expect(
      useClassApp.app.get<SkMcpCache>(extensionTokens.cache),
    ).toBeInstanceOf(RecordingCache);
    await useClassApp.close();

    const useFactoryApp = await createApp(undefined, {
      cache: { useFactory: () => new RecordingCache() },
    });
    expect(
      useFactoryApp.app.get<SkMcpCache>(extensionTokens.cache),
    ).toBeInstanceOf(RecordingCache);
    await useFactoryApp.close();

    const value = new RecordingCache();
    const useValueApp = await createApp(undefined, {
      cache: { useValue: value },
    });
    expect(useValueApp.app.get<SkMcpCache>(extensionTokens.cache)).toBe(value);
    await useValueApp.close();
  });

  it("N3: overrides.callerScopeResolver replaces the default resolver", async () => {
    const custom: CallerScopeResolver = {
      resolve: () => createCallerScope("a".repeat(64), ["tenant:acme"]),
    };
    current = await createApp(undefined, {
      callerScopeResolver: { useValue: custom },
    });
    const resolver = current.app.get<CallerScopeResolver>(
      extensionTokens.callerScopeResolver,
    );
    expect(resolver.resolve(undefined).tags).toEqual(["tenant:acme"]);
  });

  it("N4: forRootAsync resolves options through Nest's own injector", async () => {
    const CONFIG_TOKEN = Symbol("TEST_CONFIG");

    @Module({
      providers: [{ provide: CONFIG_TOKEN, useValue: { lifetimeMs: 5000 } }],
      exports: [CONFIG_TOKEN],
    })
    class ConfigModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [
        SkMcpModule.forRootAsync({
          imports: [ConfigModule],
          inject: [CONFIG_TOKEN],
          useFactory: (config: { lifetimeMs: number }) => {
            const options = new SkMcpOptions();
            options.cache.lifetimeMs = config.lifetimeMs;
            return options;
          },
        }),
      ],
    }).compile();
    currentApp = moduleRef.createNestApplication({ logger: false });
    await currentApp.init();

    const options = currentApp.get<SkMcpOptions>(SK_MCP_OPTIONS);
    expect(options.cache.lifetimeMs).toBe(5000);
  });

  it("N5: SkMcpCacheInvalidator is injectable under its class and its token, and delegates to the cache", async () => {
    const cache = new RecordingCache();
    current = await createApp(undefined, { cache: { useValue: cache } });

    const byClass = current.app.get(SkMcpCacheInvalidator);
    const byToken = current.app.get<SkMcpCacheInvalidator>(
      SK_MCP_CACHE_INVALIDATOR,
    );
    expect(byToken).toBe(byClass);

    const scope = createCallerScope("b".repeat(64), ["user:42"]);
    await byClass.invalidateCaller(scope);
    await byClass.invalidateTag("user:42");
    await byClass.invalidateAll();

    expect(cache.removedScopes).toEqual([scope.key]);
    expect(cache.removedTags).toEqual(["user:42"]);
    expect(cache.cleared).toBe(1);
  });
});
