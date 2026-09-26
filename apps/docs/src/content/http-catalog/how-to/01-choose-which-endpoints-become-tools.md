# How to choose which endpoints become tools

Selection decides which of your endpoints enter the catalog at all. It is not visibility and not
authorization: an unselected endpoint does not exist as far as an agent is concerned, for every
caller.

The default is **opt-in**. With no annotations anywhere, `search_tools` returns nothing. That is
the single most common "it isn't working" case.

## Opt in, one controller at a time

Mark the class, and every endpoint on it comes through.

```csharp
[ApiController]
[McpTool]
public sealed class OrdersController : ControllerBase { }
```

```ts
@Controller()
@McpTool()
export class OrdersController {}
```

Mark a method to bring in one endpoint from an unmarked class, and to attach a description:

```csharp
[HttpGet("/orders/{id:int}")]
[McpTool]
[Description("Fetches one order by id.")]
public IActionResult GetOrder(int id) => ...;
```

```ts
@Get("orders/:id")
@McpTool({ description: "Fetches one order by id." })
getOrder(@Param("id", ParseIntPipe) id: number): Order { ... }
```

On ASP.NET Core the description comes from the framework's own metadata — `[Description]`, XML doc
comments or `EndpointDescriptionAttribute` — so `[McpTool]` carries no description of its own.
NestJS has no equivalent, which is why `@McpTool({ description })` exists.

## Opt out instead, for a large backend

Decorating hundreds of endpoints is not practical. Flip the default and exclude the exceptions:

```csharp
builder.Services.AddLiaiso(options =>
{
    options.Selection.Default = SelectionDefault.Include;
});
```

```ts
LiaisoModule.forRoot((options) => {
  options.selection.default = "include";
});
```

Then remove individual endpoints or whole controllers:

```csharp
[HttpPost("/internal/reindex")]
[McpIgnore]
public IActionResult Reindex() => ...;
```

```ts
@Post("internal/reindex")
@McpIgnore()
reindex(): void {}
```

Opt-out is the realistic mode above a few dozen endpoints, and it changes what you have to think
about: with opt-in you decide what to publish, with opt-out you decide what to withhold, and
anything new is published by default.

## Withhold a whole route subtree without touching it

`[McpIgnore]` needs a class or a method you can edit, and it needs you to remember the next one
somebody adds. For a subtree that is categorically off limits, put the decision in configuration
instead:

```csharp
builder.Services.AddLiaiso(options =>
{
    options.Selection.Default = SelectionDefault.Include;
    options.Selection.Rules.Add(new SelectionRule(SelectionDefault.Exclude, Route: "/admin/**"));
    options.Selection.Rules.Add(new SelectionRule(SelectionDefault.Exclude, Method: "POST"));
});
```

```ts
LiaisoModule.forRoot((options) => {
  options.selection.default = "include";
  options.selection.rules = [
    { route: "/admin/**", decision: "exclude" },
    { method: "POST", decision: "exclude" },
  ];
});
```

A rule matches the route template, so `*` stays inside one path segment and `**` crosses them:
`/admin/*` catches `/admin/users` but not `/admin/users/5`, and `**` on its own is the catch-all.
Matching is case-sensitive, and a path parameter is matched as the literal `{id}` that the template
carries, not as a filled value. `method` is the one field that ignores case. Leave a field out to
match everything — a blank string is rejected at startup, because it would match nothing and
quietly decide nothing.

A rule reaches further than an attribute but yields to one, so the carve-out still goes on the
endpoint:

```csharp
[HttpGet("/admin/health")]
[McpTool]
public IActionResult Health() => Ok();
```

```ts
@Get("admin/health")
@McpTool({ name: "admin_health", description: "Reports health." })
health(): void {}
```

Order is not part of the meaning. Rules are ranked by how many fields they name — naming a route
and a method beats naming only one — and two equally specific rules that disagree fail the catalog
with `ambiguous_selection` instead of one quietly winning. That is why `/admin/**` excluded
alongside `/admin/health` included is an error rather than a refinement: both name one field, so
neither is sharper.

## Opt in a minimal API

Minimal-API endpoints have no class to decorate, so the marker goes on as metadata:

```csharp
app.MapGet("/health", () => Results.Ok(new { status = "healthy" }))
    .AllowAnonymous()
    .WithMetadata(
        new McpToolAttribute(),
        new EndpointDescriptionAttribute("Service health status; requires no identity."));
```

`McpToolAttribute` implements the public `IMcpSelectionMetadata` interface, so a host that already
has its own convention can implement that interface on its own type and liaiso will honour it.

## Precedence

Decisions apply at four levels — a global default, the configured rules, the container
(controller), and the operation (method) — and the **most specific one wins**. A method marker
beats a controller marker, which beats a rule, which beats the global default. So
`Selection.Default = Include` plus `[McpIgnore]` on a controller plus `[McpTool]` on one of its
methods publishes exactly that one method.

Attributes outrank rules because an attribute sits on the endpoint and a rule sits in your
startup file; the more local declaration is the more specific one.

Two conflicting markers at the _same_ level are an error, not a resolution: the catalog fails with
`ambiguous_selection` rather than picking one. The normative rules are in
[`packages/http/spec/selection-hierarchy.md`](https://github.com/kaannakiin/liaiso/blob/main/packages/http/spec/selection-hierarchy.md).

## Verify the result

Selection is reported at startup, before any agent connects:

```text
info: Liaiso.AspNetCore.LiaisoCatalogProvider[0]
      liaiso catalog: 16 discovered, 9 selected, 9 tools, 0 diagnostic(s)
```

`discovered` is what the framework knows about, `selected` is what survived selection, `tools` is
what became callable. A `selected` of `0` means no marker was found. A `tools` count below
`selected` means some endpoints were dropped afterwards — see
[how to find out why a tool is missing](/docs/http-catalog/find-out-why-a-tool-is-missing).

## What this cannot do

Selection is global, not per caller. Every caller sees the same catalog; what differs per caller is
[visibility](/docs/http-catalog/control-what-a-caller-can-see). And neither one is a security
boundary — an unselected endpoint is still reachable over plain HTTP by anyone your backend allows.
