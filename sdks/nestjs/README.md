# @sk-mcp/sdk-nestjs

An MCP layer that embeds into your existing NestJS backend. It exposes your endpoints to agents as
a search-first tool catalog and replays each call through **your own** pipeline, so your guards,
pipes and interceptors keep running unchanged. Not a gateway, not duplicated business logic.

> Status: internal, version `0.0.0`, not published to npm. Consumed today as a workspace
> dependency; [samples/demo-api](samples/demo-api) is the reference wiring.

## Requirements

- NestJS 10 or later (`@nestjs/common`, `@nestjs/core`), dev-tested against 11.x
- `@modelcontextprotocol/sdk` 1.30.0 or later
- Node 22 or later, Express as the HTTP adapter

Peers are peers on purpose: sk-mcp uses your Nest and your MCP SDK, not its own copies.

## 1. Install

```bash
pnpm add @sk-mcp/sdk-nestjs
```

Not on npm yet, so in this repository it resolves as `workspace:*`.

## 2. Wiring — three pieces

The .NET SDK is three method calls. This one is three _pieces_, because a Nest controller is your
code and a module cannot add a route to it.

**The module.** `forRoot` takes a callback that **mutates** an options instance — not an options
literal. Passing `{ visibility: { tier: "probe" } }` configures nothing.

```ts
@Module({
  imports: [
    SkMcpModule.forRoot((options) => {
      options.visibility.tier = "probe";
    }),
  ],
  controllers: [OrdersController, McpController],
})
export class AppModule {}
```

`forRootAsync({ imports, inject, useFactory })` is the async form. The module is `@Global()`, so
its providers are available without importing it again.

**The MCP controller.** Copy this; the seven injections are not guessable.

```ts
@Controller()
export class McpController {
  constructor(
    private readonly streamableHttp: SkMcpStreamableHttp,
    private readonly catalog: SkMcpCatalog,
    private readonly dispatcher: SkMcpDispatcher,
    private readonly visibility: CallerVisibilityProvider,
    @Inject(extensionTokens.invokeResultMapper)
    private readonly mapper: InvokeResultMapper,
    @Inject(extensionTokens.callerScopeResolver)
    private readonly scopes: CallerScopeResolver,
    @Inject(SK_MCP_OPTIONS) private readonly options: SkMcpOptions,
  ) {}

  @All("mcp")
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.streamableHttp.handle(req, res, () => {
      const server = new McpServer({ name: "your-api", version: "0.0.0" });
      registerSkMcpTools(server, {
        catalog: this.catalog,
        dispatcher: this.dispatcher,
        mapper: this.mapper,
        visibility: this.visibility,
        scopes: this.scopes,
        options: this.options,
      });
      return server;
    });
  }
}
```

`@All` rather than `@Post`: the default session mode is `stateless`, and the transport wants to
answer `GET`/`DELETE` with `405` itself instead of letting Nest return `404`.

**The bootstrap.**

```ts
import "reflect-metadata"; // must be the first import in the process

const app = await NestFactory.create(AppModule);
app.useGlobalPipes(new ValidationPipe({ transform: true }));

await app.init(); // before any app.get(...) / app.use(...)
await app.listen(3000);
```

> **Order is critical.** `reflect-metadata` must be imported first, or the decorators in §3 store
> nothing and your catalog comes up empty. And `await app.init()` must precede `app.use(...)` that
> resolves a provider — `app.get(...)` throws before the container is initialized.

## 3. Which endpoints become tools

The default is **opt-in**: nothing is exposed until you mark it.

```ts
@Controller()
@McpTool()
export class OrdersController {
  @Get("orders/:id")
  @McpTool({ description: "Fetches one order by id." })
  getOrder(@Param("id", ParseIntPipe) id: number): Order { ... }
}
```

NestJS has no equivalent of ASP.NET's description metadata, so `@McpTool({ description })` is how
an agent gets something to search against. Input schemas come from your `class-validator` DTOs and
your pipes: `ParseIntPipe` yields an integer, `@Min`/`@Max` become `minimum`/`maximum`.

At scale, invert it and exclude the exceptions:

```ts
SkMcpModule.forRoot((options) => {
  options.selection.default = "include";
});
```

Then `@McpIgnore()` on the endpoints or controllers you withhold.

Visibility is **not** a security mechanism. A tool hidden from the catalog still runs only if your
backend permits it; enforcement is always in your pipeline at invoke time.

## 4. Visibility and guards

This is the SDK's defining behaviour, and the thing most likely to surprise you.

sk-mcp asks every guard on an endpoint — global, controller and method — for a declaration, by
looking for a `describeVisibility()` method. **If any guard lacks it, the endpoint is marked
imperative and its visibility is `unknown` forever.**

```ts
@Injectable()
export class OrdersReadGuard implements CanActivate {
  canActivate(): boolean {
    /* your real check, unchanged */ return true;
  }

  describeVisibility(): { anonymous: "no"; policies: string[] } {
    return { anonymous: "no", policies: ["OrdersRead"] };
  }
}
```

`unknown` is not a denial: with the default `visibility.onUnknown: "show"` the tool still appears,
flagged `authUncertain`. When the guards cannot declare themselves, `visibility.tier = "probe"`
resolves them by really running them — at a cost. The full recipe, including
`visibility.probeValues`, is in the docs site's
_How to declare visibility for a NestJS guard_.

## 5. Connecting an MCP client

The endpoint speaks Streamable HTTP. `tools/list` returns only three meta-tools:

| Tool           | Job                                        |
| -------------- | ------------------------------------------ |
| `search_tools` | Finds operations by keyword, returns cards |
| `load_tool`    | Returns one operation's full input schema  |
| `invoke_tool`  | Calls it                                   |

The catalog is not dumped into `tools/list`: on a 700-endpoint backend that drowns the agent's
context. The agent searches, then loads, then calls.

This repository ships a client:

```bash
SKMCP_BASE_URL=http://127.0.0.1:3000 SKMCP_AUTH=token SKMCP_USER=alice \
  node sdks/nestjs/samples/agent-client/dist/main.js --scenario smoke --query "create order"
```

To protect `/mcp`, set `options.resourceServer` and the module installs bearer verification plus
the RFC 9728 metadata handler for you.

## 6. Troubleshooting

| Symptom                                        | Cause                                                               | Fix                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `search_tools` always empty                    | `selection.default` is `exclude` and nothing is decorated           | Add `@McpTool()`, or set `selection.default = "include"`                        |
| Everything comes back `authUncertain`          | A guard without `describeVisibility()`, or `tier` still declarative | Declare the guards, or set `visibility.tier = "probe"`                          |
| Catalog empty, decorators appear to do nothing | `reflect-metadata` not imported first                               | Make it the first import in `main.ts`                                           |
| Startup throws resolving a provider            | `app.use(...)` before `app.init()`                                  | `await app.init()` first                                                        |
| No PRM document, 401 carries no pointer        | `resourceServer` unset                                              | Set `options.resourceServer`; check `/.well-known/oauth-protected-resource/mcp` |
| `GET /mcp` returns 405                         | `transport.sessionMode` is `stateless` (the default)                | Expected. Use `POST`, or switch to `stateful`                                   |
| Host will not boot, fatal diagnostic           | `name_collision` / `ambiguous_selection` / `invalid_name`           | Read the codes in the log, then `options.diagnostics.downgrade`                 |

## 7. What's next

- The docs site: `pnpm --filter @sk-mcp/docs dev` → `http://localhost:5180`
- [samples/demo-api](samples/demo-api) — the same endpoint matrix as the .NET sample: anonymous,
  identity-only, policy, role, imperative ownership, and a POST with path, query and body
