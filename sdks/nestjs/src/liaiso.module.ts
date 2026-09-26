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
import { MemoryLiaisoCache, type LiaisoCache } from "@liaiso/core";
import { LiaisoCatalog } from "./catalog.js";

const LIAISO_PROBE_RESET = Symbol("LIAISO_PROBE_RESET");
const LIAISO_LIST_CHANGED = Symbol("LIAISO_LIST_CHANGED");
import { DeclarativeVisibilityEvaluator } from "./visibility/evaluator.js";
import {
  LiaisoProbeEvaluator,
  LiaisoProbeInterceptor,
  type ProbeEvaluator,
} from "./visibility/probe.js";
import { CallerVisibilityProvider } from "./visibility/provider.js";
import type { VisibilityEvaluator } from "./visibility/evaluator.js";
import {
  CarrierHashCallerScopeResolver,
  LIAISO_CACHE_INVALIDATOR,
  LiaisoCacheInvalidator,
} from "./cache.js";
import { LiaisoDispatcher } from "./dispatcher.js";
import {
  extensionTokens,
  toProviders,
  type ExtensionOverrides,
} from "./extension-points.js";
import { DefaultInvokeResultMapper } from "./invoke-result-mapper.js";
import { LIAISO_OPTIONS, LiaisoOptions } from "./options.js";
import { validateLiaisoOptions } from "./options-validation.js";
import { withAudienceCheck } from "./transport/audience.js";
import {
  protectedResourceMetadataHandler,
  protectedResourceMetadataPath,
  protectedResourceMetadataUrl,
} from "./transport/protected-resource-metadata.js";
import { LiaisoStreamableHttp } from "./transport/streamable-http.js";

export interface LiaisoModuleAsyncOptions {
  imports?: DynamicModule["imports"];
  inject?: InjectionToken[];
  useFactory: (...args: never[]) => LiaisoOptions | Promise<LiaisoOptions>;
  overrides?: ExtensionOverrides;
}

function defaultProviders(): Provider[] {
  return [
    {
      provide: extensionTokens.cache,
      useFactory: (options: LiaisoOptions) =>
        new MemoryLiaisoCache({
          lifetimeMs: options.cache.lifetimeMs,
          maxCallers: options.cache.maxCallers,
        }),
      inject: [LIAISO_OPTIONS],
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
      useFactory: (dispatcher: LiaisoDispatcher, options: LiaisoOptions) =>
        new LiaisoProbeEvaluator(dispatcher, options),
      inject: [LiaisoDispatcher, LIAISO_OPTIONS],
    },
    {
      provide: LIAISO_PROBE_RESET,
      useFactory: (catalog: LiaisoCatalog, prober: ProbeEvaluator) =>
        catalog.onChange(() => {
          if (prober instanceof LiaisoProbeEvaluator) {
            prober.clearDisabled();
          }
        }),
      inject: [LiaisoCatalog, extensionTokens.probeEvaluator],
    },
    {
      provide: CallerVisibilityProvider,
      useFactory: (
        evaluator: VisibilityEvaluator,
        prober: ProbeEvaluator,
        cache: LiaisoCache,
        options: LiaisoOptions,
      ) => new CallerVisibilityProvider(evaluator, prober, cache, options),
      inject: [
        extensionTokens.visibilityEvaluator,
        extensionTokens.probeEvaluator,
        extensionTokens.cache,
        LIAISO_OPTIONS,
      ],
    },
    {
      /**
       * Guard: the 2026-07-28 revision delivers `tools/list_changed` only on a
       * `subscriptions/listen` stream the client opened, so the notification has to be published on
       * the handler's bus. It cannot be bound per session any more — there are no sessions, and the
       * per-request server the handler builds is gone before the next catalogue reload.
       */
      provide: LIAISO_LIST_CHANGED,
      useFactory: (catalog: LiaisoCatalog, transport: LiaisoStreamableHttp) =>
        catalog.onChange(() => {
          transport.notifyToolListChanged();
        }),
      inject: [LiaisoCatalog, LiaisoStreamableHttp],
    },
    { provide: APP_INTERCEPTOR, useClass: LiaisoProbeInterceptor },
    LiaisoCatalog,
    LiaisoDispatcher,
    LiaisoStreamableHttp,
    LiaisoCacheInvalidator,
    {
      provide: LIAISO_CACHE_INVALIDATOR,
      useExisting: LiaisoCacheInvalidator,
    },
  ];
}

function moduleExports(): Array<Type<unknown> | InjectionToken> {
  return [
    ...Object.values(extensionTokens),
    CallerVisibilityProvider,
    LiaisoCatalog,
    LiaisoDispatcher,
    LiaisoStreamableHttp,
    LiaisoCacheInvalidator,
    LIAISO_CACHE_INVALIDATOR,
    LIAISO_OPTIONS,
  ];
}

@Global()
@Module({})
export class LiaisoModule implements NestModule {
  constructor(
    @Inject(LIAISO_OPTIONS) private readonly options: LiaisoOptions,
  ) {}

  static forRoot(
    configure?: (options: LiaisoOptions) => void,
    overrides?: ExtensionOverrides,
  ): DynamicModule {
    const options = new LiaisoOptions();
    configure?.(options);
    validateLiaisoOptions(options);
    return {
      module: LiaisoModule,
      imports: [DiscoveryModule],
      providers: [
        { provide: LIAISO_OPTIONS, useValue: options },
        ...defaultProviders(),
        ...toProviders(overrides),
      ],
      exports: moduleExports(),
    };
  }

  static forRootAsync(asyncOptions: LiaisoModuleAsyncOptions): DynamicModule {
    return {
      module: LiaisoModule,
      imports: [DiscoveryModule, ...(asyncOptions.imports ?? [])],
      providers: [
        {
          provide: LIAISO_OPTIONS,
          useFactory: async (...args: unknown[]) => {
            const options = await asyncOptions.useFactory(...(args as never[]));
            validateLiaisoOptions(options);
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
