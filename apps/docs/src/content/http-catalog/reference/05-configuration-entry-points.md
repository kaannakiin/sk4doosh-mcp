# Configuration entry points

Signatures only: what you call, what it returns, and where the options themselves are defined.
There are no output examples on this page by design — nothing here produces output.

Verified against `SkMcp.AspNetCore` `0.1.0-alpha.1` and `@sk-mcp/sdk-nestjs` at the current
workspace version. This surface has no generator, so it is hand-maintained and may lag a release.

## ASP.NET Core

Three calls, in this order.

```csharp
IServiceCollection AddSkMcp(this IServiceCollection services, Action<SkMcpOptions>? configure = null)
IApplicationBuilder UseSkMcpCapture(this IApplicationBuilder app)
IEndpointConventionBuilder MapSkMcp(this IEndpointRouteBuilder endpoints, string pattern = "/mcp")
```

`AddSkMcp` also registers `AddEndpointsApiExplorer()`, decorates the authorization result handler
so probes can short-circuit, and calls `AddMcpServer().WithHttpTransport()`. Options are validated
at startup.

`MapSkMcp` returns `IEndpointConventionBuilder`, which is why endpoint conventions compose:

```csharp
app.MapSkMcp("/mcp").RequireAuthorization();
```

It throws at startup if `UseSkMcpCapture()` was never registered.

Selection markers:

```csharp
[McpTool]      // Name, Prefix, ReadOnly, Destructive, Idempotent
[McpIgnore]
interface IMcpSelectionMetadata { bool Include { get; } }
```

`IMcpSelectionMetadata` is public, so a host can attach selection through its own metadata type.

Option groups are ten properties on `SkMcpOptions` — `Identity`, `Synthetic`, `Selection`,
`Schema`, `Naming`, `Visibility`, `Cache`, `Errors`, `ResourceServer`, `Diagnostics`. Their fields
and defaults are in
[`SkMcpOptions.cs`](https://github.com/kaannakiin/sk4doosh-mcp/blob/main/sdks/dotnet/src/SkMcp.AspNetCore/SkMcpOptions.cs);
this page does not copy them.

## NestJS

```ts
SkMcpModule.forRoot(
  configure?: (options: SkMcpOptions) => void,
  overrides?: ExtensionOverrides,
): DynamicModule

SkMcpModule.forRootAsync(asyncOptions: {
  imports?: DynamicModule["imports"];
  inject?: InjectionToken[];
  useFactory: (...args: never[]) => SkMcpOptions | Promise<SkMcpOptions>;
  overrides?: ExtensionOverrides;
}): DynamicModule
```

`forRoot` takes a **callback that mutates an options instance**, not an options literal. This is
the most common miswiring in the SDK: passing an object configures nothing.

The module is `@Global()`. When `resourceServer` is set it also installs the PRM handler and bearer
verification on the MCP path itself.

There is no `MapSkMcp` equivalent. You write the MCP route:

```ts
SkMcpStreamableHttp.handle(
  req: Request,
  res: Response,
  createServer: () => McpServer,
): Promise<void>

registerSkMcpTools(server: McpServer, deps: MetaToolDependencies): () => void
```

`MetaToolDependencies` is `{ catalog, dispatcher, mapper, visibility, scopes, options }` —
injectable as `SkMcpCatalog`, `SkMcpDispatcher`, `extensionTokens.invokeResultMapper`,
`CallerVisibilityProvider`, `extensionTokens.callerScopeResolver` and `SK_MCP_OPTIONS`. The
tutorial has the whole controller:
[mounting your first NestJS MCP endpoint](/docs/http-catalog/mounting-your-first-nestjs-mcp-endpoint).

Selection markers:

```ts
@McpTool(options?: {
  name?: string; prefix?: string; description?: string;
  body?: JsonSchemaObject;
  readOnly?: boolean; destructive?: boolean; idempotent?: boolean;
})
@McpIgnore()
```

Guard declaration, read once at catalog build time:

```ts
interface VisibilityDeclaration {
  readonly anonymous?: "yes" | "no" | "unknown";
  readonly policies?: readonly string[];
}
```

Option fields and defaults are in
[`options.ts`](https://github.com/kaannakiin/sk4doosh-mcp/blob/main/sdks/nestjs/src/options.ts).
The two option trees are not the same shape — the NestJS tree has a `transport` group the .NET one
does not — so read each SDK's own file rather than assuming parity.

## Extension points

Six internals are replaceable, addressed by `extensionTokens` and overridden through `forRoot`'s
second argument (`useClass`, `useFactory` or `useValue`):

```text
cache · callerScopeResolver · invokeResultMapper · sessionStore · visibilityEvaluator · probeEvaluator
```

Cache invalidation is a service, not an option:

```ts
SkMcpCacheInvalidator.invalidateCaller(...) | invalidateTag(...) | invalidateAll()
```

Each token names an internal the host may replace; the shapes they expect are in the SDK's own
source, next to the token definitions.

## Catalog reload

```ts
SkMcpCatalog.reload(): void
```

Rebuilds the catalog, bumps the generation counter, and fires the change listeners that re-stamp
`_meta` and send `notifications/tools/list_changed`. See
[meta-tool contract](/docs/http-catalog/meta-tool-contract).
