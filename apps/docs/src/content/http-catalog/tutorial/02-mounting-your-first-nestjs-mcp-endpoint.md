# Mounting your first NestJS MCP endpoint

By the end of this page a NestJS controller method will be reachable by an agent, and the request
will pass through your guards on the way in.

The NestJS SDK does not map the MCP endpoint for you. You write that controller. This page walks
the three pieces you need, using this repository's `demo-api` sample as the working code.

## 1. Register the module

Open `sdks/nestjs/samples/demo-api/src/app.module.ts`:

```ts
@Module({
  imports: [
    SkMcpModule.forRoot((options) => {
      options.visibility.tier = "probe";
    }),
  ],
  controllers: [AuthController, OrdersController, McpController],
})
export class AppModule {}
```

`forRoot` takes a **callback that mutates an options object** — not an options literal. Passing
`{ visibility: { tier: "probe" } }` compiles in neither direction and configures nothing. The
async form is `forRootAsync({ imports, inject, useFactory })` when your options depend on
injected config.

## 2. Write the MCP controller

`src/.mcp.controllerts` is the piece with no shortcut. Copy it as-is:

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
      const server = new McpServer({ name: "demo-api", version: "0.0.0" });
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

The seven injections are not guessable and the SDK cannot supply them for you — a NestJS controller
is your code, and the module has no way to add a route to it. `SkMcpModule` is `@Global()`, so the
providers are available without importing anything else.

`@All` matters. The default session mode is `stateless`, which answers `POST` and rejects `GET` and
`DELETE` with a `405`; `@All` lets the transport produce that rejection itself instead of Nest
producing a `404`.

## 3. Bootstrap in the right order

`src/main.ts`:

```ts
import "reflect-metadata";
// ...
const app = await NestFactory.create(AppModule);
app.useGlobalPipes(new ValidationPipe({ transform: true }));

await app.init();

app.use(mcpAuthRouter({ provider: app.get(DemoOAuthProvider), ... }));
await app.listen(3000);
```

`reflect-metadata` must be the first import in the process, or the decorators in step 4 store
nothing and your catalog comes up empty.

`await app.init()` before `app.use(...)` is the second trap: `app.get(...)` cannot resolve a
provider until the container is initialized, so mounting the auth router first throws at startup.

## 4. Mark one endpoint

Nothing is exposed by default. In `src/orders.controller.ts`:

```ts
@Controller()
@McpTool()
export class OrdersController {
  @Post("orders")
  @UseGuards(JwtGuard)
  @McpTool({ description: "Creates a new order." })
  create(@Body() dto: CreateOrderDto): Order { ... }
}
```

`@McpTool()` on the class opts the controller in; `@McpTool({ description })` on the method gives
the agent something to search against. The `CreateOrderDto`'s `class-validator` decorators become
the tool's input schema, and `@UseGuards(JwtGuard)` is untouched — it runs when the agent calls.

## 5. Build and start

```bash
pnpm turbo run build --filter=@sk-mcp/demo-nestjs
node sdks/nestjs/samples/demo-api/dist/main.js
```

```text
[Nest] LOG [RouterExplorer] Mapped {/orders, POST} route
[Nest] LOG [RoutesResolver] McpController {/}:
[Nest] LOG [RouterExplorer] Mapped {/mcp, ALL} route
demo-api: http://localhost:3000 (MCP endpoint: POST /mcp)
```

Leave it running.

## 6. Connect an agent

In a second terminal:

```bash
SKMCP_BASE_URL=http://127.0.0.1:3000 SKMCP_AUTH=token SKMCP_USER=alice \
  node sdks/nestjs/samples/agent-client/dist/main.js \
  --scenario smoke --query "create order" \
  --tool create_order --arguments '{"item":"usb-c dock","quantity":1}'
```

```text
step                         ok    detail
tools/list                   ok    search_tools, load_tool, invoke_tool
search_tools "create order"  ok    7/8 results
load_tool create_order       ok    {"type":"object","properties":{"item":{"type":"string","minLength":1},"quantity":{"type":"integer","minimum":1,"maximum":100}},"required":["item","quantity"],"additionalProperties":false}
invoke_tool create_order     ok    {"status":201,"body":{"id":1,"item":"usb-c dock","quantity":1,"owner":"alice","notes":[]}}
```

`SKMCP_AUTH=token` uses the sample's `POST /auth/token` shortcut. The order id increments on each
run.

`load_tool` built that schema from `CreateOrderDto`: `minLength: 1` came from `@MinLength(1)`,
`minimum`/`maximum` from `@Min(1)`/`@Max(100)`. `invoke_tool` reached the handler through
`JwtGuard` and got a `201`.

## What you just built

An agent can search, read and call your NestJS endpoints, and every call went through your guards.

Two things in that output are worth chasing. The schema has no property descriptions, because
NestJS exposes no equivalent of ASP.NET's description metadata — you supply those with
`@McpTool({ description })` per method. And `search_tools` returned 7 of 8, not 8 of 8, because
this sample's guards are imperative code, so sk-mcp cannot read what they mean and falls back to
probing.

That second one is the SDK's defining behaviour:
[how to declare visibility for a NestJS guard](/docs/http-catalog/declare-visibility-for-a-nestjs-guard)
is the fix, and
[why the two SDKs do not feel the same](/docs/http-catalog/why-the-two-sdks-do-not-feel-the-same)
is the reason it exists.
