# Exposing your first ASP.NET Core endpoint to an agent

By the end of this page an agent will find an endpoint you wrote, read its schema, and call it —
through your own authorization pipeline.

You will work inside this repository's `DemoApi` sample, so the SDK is already referenced and you
can see a result in a couple of minutes. To add the package to your own project instead, the
install steps are in [`sdks/dotnet/README.md`](https://github.com/kaannakiin/sk4doosh-mcp/blob/main/sdks/dotnet/README.md).

## 1. Look at the three calls

Open `sdks/dotnet/samples/DemoApi/Program.cs`. Every sk-mcp integration is these three calls and
nothing else:

```csharp
builder.Services.AddSkMcp();

var app = builder.Build();

app.UseSkMcpCapture();

app.UseRouting();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapSkMcp("/mcp");
```

`AddSkMcp()` registers discovery. `UseSkMcpCapture()` takes a handle on the pipeline. `MapSkMcp()`
serves the MCP endpoint.

`UseSkMcpCapture()` captures the pipeline **from that point onward** and replays agent calls into
it. Put it before `UseRouting`, `UseAuthentication` and `UseAuthorization`, as early as you can. If
it sits after them, agent requests never reach your authentication layer. If you leave it out
entirely, the host refuses to start:

```text
MapSkMcp() requires app.UseSkMcpCapture() earlier in the pipeline, before UseRouting(),
UseAuthentication() and UseAuthorization(). Add app.UseSkMcpCapture() near the top of the pipeline.
```

## 2. Mark one endpoint

Nothing is exposed by default. Open `Controllers/OrdersController.cs` and find the endpoint that
reads one order:

```csharp
[HttpGet("/orders/{id:int}")]
[Authorize(Policy = "OrdersRead")]
[Description("Fetches one order by id.")]
public IActionResult GetOrder([Description("Order id")] int id) =>
    Orders.TryGetValue(id, out var order) ? Ok(order) : NotFound();
```

Two things carry into the catalog. `[McpTool]` on the class opts the controller in. `[Description]`
becomes the tool description an agent searches against — sk-mcp reads ASP.NET's own description
metadata, so you are not writing a second copy of anything.

The `[Authorize(Policy = "OrdersRead")]` line is untouched by sk-mcp. It will run when the agent
calls.

## 3. Start the backend

```bash
dotnet run --project sdks/dotnet/samples/DemoApi
```

The catalog is built at startup and reports what it found:

```text
info: SkMcp.AspNetCore.SkMcpCatalogProvider[0]
      sk-mcp catalog: 16 discovered, 9 selected, 9 tools, 0 diagnostic(s)
```

Sixteen endpoints exist; nine were selected, because selection is opt-in and only the decorated
ones came through. Nine became tools with no diagnostics.

Leave it running.

## 4. Connect an agent

In a second terminal, run the repository's example client:

```bash
node apps/example-agent-client/dist/main.js --scenario smoke --query "get order"
```

```text
step                      ok    detail
tools/list                ok    load_tool, search_tools, invoke_tool
search_tools "get order"  ok    8/8 results
load_tool get_order       ok    {"type":"object","properties":{"id":{"type":"integer","description":"Order id"}},"required":["id"],"additionalProperties":false}
invoke_tool get_order     ok    {"status":200,"body":{"id":1,"item":"mechanical keyboard","quantity":2,"owner":"alice"}}
```

That is the whole product in four lines.

`tools/list` returned three tools, not nine. The catalog is not dumped into the agent's context;
the agent searches it. `search_tools` matched your description and returned a compact card.
`load_tool` produced the input schema from the method signature — `id` is an integer because the
route constraint says `{id:int}`, and the description came from your attribute. `invoke_tool`
called the endpoint and got the order back with a `200`.

The client authenticated as `alice` and her token satisfied `OrdersRead`. Your policy ran; sk-mcp
did not evaluate it.

## What you just built

The endpoint you exposed is described in exactly one place — the endpoint itself. There is no
second service and no copy to drift.

Now that a tool exists, `bob` should not be able to see all of it. That is
[seeing visibility filtering in action](/docs/http-catalog/seeing-visibility-filtering-in-action).
To expose hundreds of endpoints without decorating each one, read
[how to choose which endpoints become tools](/docs/http-catalog/choose-which-endpoints-become-tools).
