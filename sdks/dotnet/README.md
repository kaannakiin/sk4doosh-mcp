# SkMcp.AspNetCore

An MCP layer that embeds into your existing ASP.NET Core backend. It exposes your endpoints to
agents as a search-first tool catalog and replays each call through **your own** pipeline, so your
authentication and authorization keep working exactly as they do today. Not a gateway, not
duplicated business logic.

> Status: `0.1.0-alpha.1`. The public API is frozen in this release but it is alpha; breaking
> changes are possible.

## Requirements

- An ASP.NET Core Web API project targeting `net8.0` or `net10.0`
- Controller or minimal-API endpoints (discovery goes through ApiExplorer)

## 1. Install

The alpha ships from a local nupkg feed; it is not on nuget.org.

```bash
# in the sk-mcp repository
pnpm turbo run pack --filter=@sk-mcp/sdk-dotnet
# → sdks/dotnet/local/nupkg-feed/SkMcp.AspNetCore.0.1.0-alpha.1.nupkg
```

```bash
# in your own project
dotnet nuget add source /absolute/path/to/sk-mcp/sdks/dotnet/local/nupkg-feed --name sk-mcp-local
dotnet add package SkMcp.AspNetCore --version 0.1.0-alpha.1
```

Do not wire it with a `ProjectReference`. SkMcp multi-targets (`net8.0;net10.0`) and a
`ProjectReference` evaluates every target during restore, which produces `NETSDK1045` on a host
that pins an older SDK through `global.json`. The package path does not have this problem: the
host's SDK picks whichever target it can build.

## 2. Wiring — three calls

```csharp
using SkMcp.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddSkMcp();

var app = builder.Build();

app.UseSkMcpCapture();

app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapSkMcp("/mcp");

app.Run();
```

Leave your existing `AddAuthentication`/`AddAuthorization` setup alone — SkMcp installs no identity
scheme of its own and uses yours.

> **Order is critical.** `UseSkMcpCapture()` captures the pipeline **from that point onward** and
> injects agent calls into it. Put it **before** `UseRouting`/`UseAuthentication`/`UseAuthorization`,
> as early as you can. Placed after them, agent requests never see your authentication layer. Omit
> it entirely and `MapSkMcp()` throws at startup.

## 3. Which endpoints become visible?

The default is **opt-in**: nothing is exposed, and what you mark with `[McpTool]` is.

```csharp
using SkMcp.AspNetCore.Discovery;

[ApiController]
[Route("orders")]
[McpTool]
public sealed class OrdersController : ControllerBase { }
```

On a backend with hundreds of endpoints the attribute path is impractical; switch to opt-out and
close individual exceptions with `[McpIgnore]`:

```csharp
builder.Services.AddSkMcp(options =>
{
    options.Selection.Default = SelectionDefault.Include;
});
```

Visibility is **not** a security mechanism. A tool hidden from the catalog still runs only if your
backend permits it; enforcement is always in your pipeline at invoke time.

## 4. Connecting an MCP client

The endpoint speaks Streamable HTTP. `tools/list` returns only three meta-tools:

| Tool           | Job                                             |
| -------------- | ----------------------------------------------- |
| `search_tools` | Searches endpoints with a natural-language query |
| `load_tool`    | Returns one tool's full schema                   |
| `invoke_tool`  | Calls the tool                                   |

The catalog is not dumped into `tools/list`: on a 700-endpoint backend that drowns the agent's
context. The agent searches first, then loads, then calls.

To protect `/mcp`, attach your own authorization:

```csharp
app.MapSkMcp("/mcp").RequireAuthorization();
```

This repository's `sdks/nestjs/samples/agent-client` is a ready-made client:

```bash
node sdks/nestjs/samples/agent-client/dist/main.js --scenario smoke --query "get order"
```

Pass `--query`; the scenario's built-in default query is a non-ASCII term used to exercise
tokenization.

## 5. Troubleshooting

| Symptom                                                       | Cause                                                                       | Fix                                                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `MapSkMcp() requires app.UseSkMcpCapture()...` at startup     | Capture was never called                                                     | Add `app.UseSkMcpCapture()`, before routing                                             |
| `sk-mcp pipeline is not captured` on the first tool call      | Capture is registered but the host has not served a request yet              | Start the host; if it persists, check where capture sits                                 |
| Tools work but authorization never runs                       | Capture is **after** `UseAuthentication`/`UseAuthorization`                  | Move capture to the top of the pipeline                                                  |
| `search_tools` always empty                                   | `Selection.Default` defaults to `Exclude` and no `[McpTool]` was applied     | Add `[McpTool]`, or set `Selection.Default = Include`                                    |
| Every request to `/mcp` returns 401                           | `.RequireAuthorization()` is on and the client sends no token                | Send a bearer token, or drop `.RequireAuthorization()` during development                |
| Host will not start, fatal diagnostic                         | A catalog error such as `name_collision` / `invalid_name`                   | Read the code list in the log; downgrade a single code with `options.Diagnostics.Downgrade` |

## 6. What's next

- The docs site: `pnpm --filter @sk-mcp/docs dev` → `http://localhost:5180`
- Sample: [samples/DemoApi](samples/DemoApi) — policy, role, imperative ownership checks and
  anonymous endpoints in a single controller
