import {
  Global,
  Inject,
  Module,
  RequestMethod,
  type DynamicModule,
  type InjectionToken,
  type MiddlewareConsumer,
  type NestModule,
  type Provider,
  type Type,
} from "@nestjs/common";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { MemorySkMcpCache } from "@sk-mcp/core";
import {
  CarrierHashCallerScopeResolver,
  SK_MCP_CACHE_INVALIDATOR,
  SkMcpCacheInvalidator,
} from "./cache.js";
import { SkMcpDispatcher } from "./dispatcher.js";
import {
  extensionTokens,
  toProviders,
  type ExtensionOverrides,
} from "./extension-points.js";
import { DefaultInvokeResultMapper } from "./invoke-result-mapper.js";
import { SK_MCP_OPTIONS, SkMcpOptions } from "./options.js";
import { withAudienceCheck } from "./transport/audience.js";
import {
  protectedResourceMetadataHandler,
  protectedResourceMetadataPath,
  protectedResourceMetadataUrl,
} from "./transport/protected-resource-metadata.js";
import { InMemorySessionStore } from "./transport/session-store.js";
import { SkMcpStreamableHttp } from "./transport/streamable-http.js";

export interface SkMcpModuleAsyncOptions {
  imports?: DynamicModule["imports"];
  inject?: InjectionToken[];
  useFactory: (...args: never[]) => SkMcpOptions | Promise<SkMcpOptions>;
  overrides?: ExtensionOverrides;
}

function defaultProviders(): Provider[] {
  return [
    {
      provide: extensionTokens.cache,
      useFactory: (options: SkMcpOptions) =>
        new MemorySkMcpCache({
          lifetimeMs: options.cache.lifetimeMs,
          maxCallers: options.cache.maxCallers,
        }),
      inject: [SK_MCP_OPTIONS],
    },
    {
      provide: extensionTokens.callerScopeResolver,
      useClass: CarrierHashCallerScopeResolver,
    },
    {
      provide: extensionTokens.invokeResultMapper,
      useClass: DefaultInvokeResultMapper,
    },
    { provide: extensionTokens.sessionStore, useClass: InMemorySessionStore },
    SkMcpDispatcher,
    SkMcpStreamableHttp,
    SkMcpCacheInvalidator,
    { provide: SK_MCP_CACHE_INVALIDATOR, useExisting: SkMcpCacheInvalidator },
  ];
}

function moduleExports(): Array<Type<unknown> | InjectionToken> {
  return [
    ...Object.values(extensionTokens),
    SkMcpDispatcher,
    SkMcpStreamableHttp,
    SkMcpCacheInvalidator,
    SK_MCP_CACHE_INVALIDATOR,
    SK_MCP_OPTIONS,
  ];
}

@Global()
@Module({})
export class SkMcpModule implements NestModule {
  constructor(@Inject(SK_MCP_OPTIONS) private readonly options: SkMcpOptions) {}

  static forRoot(
    configure?: (options: SkMcpOptions) => void,
    overrides?: ExtensionOverrides,
  ): DynamicModule {
    const options = new SkMcpOptions();
    configure?.(options);
    return {
      module: SkMcpModule,
      providers: [
        { provide: SK_MCP_OPTIONS, useValue: options },
        ...defaultProviders(),
        ...toProviders(overrides),
      ],
      exports: moduleExports(),
    };
  }

  static forRootAsync(asyncOptions: SkMcpModuleAsyncOptions): DynamicModule {
    return {
      module: SkMcpModule,
      imports: asyncOptions.imports ?? [],
      providers: [
        {
          provide: SK_MCP_OPTIONS,
          useFactory: asyncOptions.useFactory,
          inject: asyncOptions.inject ?? [],
        },
        ...defaultProviders(),
        ...toProviders(asyncOptions.overrides),
      ],
      exports: moduleExports(),
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    const resourceServer = this.options.resourceServer;
    if (resourceServer === undefined) {
      return;
    }
    const mcpPath = resourceServer.mcpPath ?? "/mcp";

    consumer.apply(protectedResourceMetadataHandler(resourceServer)).forRoutes({
      path: protectedResourceMetadataPath(mcpPath),
      method: RequestMethod.GET,
    });

    consumer
      .apply(
        requireBearerAuth({
          verifier: withAudienceCheck(
            resourceServer.verifier,
            resourceServer.resource,
          ),
          resourceMetadataUrl: protectedResourceMetadataUrl(
            resourceServer.resource,
            mcpPath,
          ).toString(),
        }),
      )
      .forRoutes({ path: mcpPath, method: RequestMethod.ALL });
  }
}
