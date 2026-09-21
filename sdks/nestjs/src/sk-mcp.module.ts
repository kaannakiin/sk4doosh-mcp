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
import { APP_INTERCEPTOR, DiscoveryModule } from "@nestjs/core";
import { requireBearerAuth } from "@modelcontextprotocol/express";
import { MemorySkMcpCache, type SkMcpCache } from "@sk-mcp/core";
import { SkMcpCatalog } from "./catalog.js";

const SK_MCP_PROBE_RESET = Symbol("SK_MCP_PROBE_RESET");
const SK_MCP_LIST_CHANGED = Symbol("SK_MCP_LIST_CHANGED");
import { DeclarativeVisibilityEvaluator } from "./visibility/evaluator.js";
import {
  SkMcpProbeEvaluator,
  SkMcpProbeInterceptor,
  type ProbeEvaluator,
} from "./visibility/probe.js";
import { CallerVisibilityProvider } from "./visibility/provider.js";
import type { VisibilityEvaluator } from "./visibility/evaluator.js";
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
import { validateSkMcpOptions } from "./options-validation.js";
import { withAudienceCheck } from "./transport/audience.js";
import {
  protectedResourceMetadataHandler,
  protectedResourceMetadataPath,
  protectedResourceMetadataUrl,
} from "./transport/protected-resource-metadata.js";
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
    {
      provide: extensionTokens.visibilityEvaluator,
      useClass: DeclarativeVisibilityEvaluator,
    },
    {
      provide: extensionTokens.probeEvaluator,
      useFactory: (dispatcher: SkMcpDispatcher, options: SkMcpOptions) =>
        new SkMcpProbeEvaluator(dispatcher, options),
      inject: [SkMcpDispatcher, SK_MCP_OPTIONS],
    },
    {
      provide: SK_MCP_PROBE_RESET,
      useFactory: (catalog: SkMcpCatalog, prober: ProbeEvaluator) =>
        catalog.onChange(() => {
          if (prober instanceof SkMcpProbeEvaluator) {
            prober.clearDisabled();
          }
        }),
      inject: [SkMcpCatalog, extensionTokens.probeEvaluator],
    },
    {
      provide: CallerVisibilityProvider,
      useFactory: (
        evaluator: VisibilityEvaluator,
        prober: ProbeEvaluator,
        cache: SkMcpCache,
        options: SkMcpOptions,
      ) => new CallerVisibilityProvider(evaluator, prober, cache, options),
      inject: [
        extensionTokens.visibilityEvaluator,
        extensionTokens.probeEvaluator,
        extensionTokens.cache,
        SK_MCP_OPTIONS,
      ],
    },
    {
      /**
       * Guard: the 2026-07-28 revision delivers `tools/list_changed` only on a
       * `subscriptions/listen` stream the client opened, so the notification has to be published on
       * the handler's bus. It cannot be bound per session any more — there are no sessions, and the
       * per-request server the handler builds is gone before the next catalogue reload.
       */
      provide: SK_MCP_LIST_CHANGED,
      useFactory: (catalog: SkMcpCatalog, transport: SkMcpStreamableHttp) =>
        catalog.onChange(() => {
          transport.notifyToolListChanged();
        }),
      inject: [SkMcpCatalog, SkMcpStreamableHttp],
    },
    { provide: APP_INTERCEPTOR, useClass: SkMcpProbeInterceptor },
    SkMcpCatalog,
    SkMcpDispatcher,
    SkMcpStreamableHttp,
    SkMcpCacheInvalidator,
    { provide: SK_MCP_CACHE_INVALIDATOR, useExisting: SkMcpCacheInvalidator },
  ];
}

function moduleExports(): Array<Type<unknown> | InjectionToken> {
  return [
    ...Object.values(extensionTokens),
    CallerVisibilityProvider,
    SkMcpCatalog,
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
    validateSkMcpOptions(options);
    return {
      module: SkMcpModule,
      imports: [DiscoveryModule],
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
      imports: [DiscoveryModule, ...(asyncOptions.imports ?? [])],
      providers: [
        {
          provide: SK_MCP_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const options = await asyncOptions.useFactory(...(args as never[]));
            validateSkMcpOptions(options);
            return options;
          },
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
