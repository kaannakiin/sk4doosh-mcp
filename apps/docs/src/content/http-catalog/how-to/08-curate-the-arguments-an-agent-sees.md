# How to curate the arguments an agent sees

Your DTO was written for HTTP clients. Handed to an agent unchanged it exposes arguments the agent
cannot know, cannot interpret, and should not touch. Curation declares a different agent-facing
surface over the same endpoint, without editing the DTO and without breaking your REST clients.

Three things you can do to an argument: rename it, re-describe it, or hide it and supply the value
yourself.

## Rename and re-describe

```csharp
[HttpGet("orders")]
[McpTool(Description = "Search orders by keyword.")]
[McpArgument("q", Name = "keyword", Description = "Free-text search over item names.")]
[McpArgument("lim", Name = "max_results")]
public IActionResult List([FromQuery] ListOrdersQuery query) => ...;
```

```ts
@Get("orders")
@McpTool({
  description: "Search orders by keyword.",
  arguments: curate<ListOrdersQuery>({
    q: { as: "keyword", description: "Free-text search over item names." },
    lim: { as: "max_results" },
  }),
})
list(@Query() query: ListOrdersQuery) { ... }
```

The agent now sends `keyword` and `max_results`. The request still goes out as `?q=…&lim=…`:
curation changes what the agent sends, never what reaches your backend. Sending the old name is an
`unknown_argument` error, so the agent cannot route around the rename.

`curate<T>()` is optional. Without it `arguments` takes a plain record; with it a name that is not
a key of your DTO fails to compile, which is where a typo belongs.

## Hide an argument

Three ways to hide one, and the difference matters.

| You want                           | Use              |
| ---------------------------------- | ---------------- |
| A fixed value on every call        | a constant       |
| A value from the caller's token    | a named provider |
| The backend's own default to stand | omit it          |

```csharp
[McpArgument("tenantId", Hidden = true, ValueFrom = "tenant")]
[McpArgument("fq", Hidden = true, Value = "status:active")]
[McpArgument("includeDeleted", Hidden = true)]
```

```ts
arguments: curate<ListOrdersQuery>({
  tenantId: hidden.from("tenant"),
  fq: hidden.value("status:active"),
  includeDeleted: hidden.omit(),
});
```

Writing a constant **overrides** whatever default your backend would have applied. Omitting sends
nothing at all, which is what you want for a flag whose default is already correct.

A required argument cannot be omitted: the backend would reject every call and the agent could do
nothing about it. That is a startup error, not a runtime surprise.

## Fill a hidden argument from the caller

Register the provider once; every endpoint that names the source uses it.

```csharp
builder.Services.AddSkMcp(options =>
{
    options.Arguments.Provide("tenant", (caller, _) =>
        ValueTask.FromResult<JsonNode?>(JsonValue.Create(caller.Claim("tenant_id"))));
});
```

```ts
SkMcpModule.forRoot((options) => {
  options.arguments.provide("tenant", (caller) => caller.claim("tenant_id"));
});
```

A source with no registered provider is a startup error, so a typo cannot become a failure that
recurs on every call.

**This is not a security boundary.** Filling `tenantId` from a verified token does not isolate
tenants; your backend's own authorization still decides, exactly as it does for every other
request. Curation is about what the agent has to think about, not about what it is allowed to do.

## Curate endpoints you cannot decorate

Rules can live in options instead, targeted by controller, action, method or route. A rule nearer
the endpoint wins, and `Seal` marks a rule no attribute or decorator may override.

```csharp
options.Arguments
    .Seal(new CurationTarget(Route: "/api/**"), rule => rule.HideFrom("tenantId", "tenant"))
    .Curate(new CurationTarget(Controller: typeof(OrdersController), Action: "List"),
        rule => rule.Rename("page", "page_number"));
```

```ts
options.arguments
  .seal({ route: "/api/**" }, { tenantId: hidden.from("tenant") })
  .curate(
    { controller: OrdersController, handler: "list" },
    { page: { as: "page_number" } },
  );
```

Rules merge per argument and per field, so a global rule that hides a tenant identifier survives a
method-level rule that only renames something else.

## Keep the description honest

Hiding `tenantId` makes a description that says "filter by tenant and status" a lie, and the agent
has no way to notice. The SDK checks for you: when a tool's **name or description** still contains
the wire name of a hidden or renamed argument, it reports `curation_leaks_name`. A description you
write on a curated argument is checked too, under `curation_leaks_name_in_argument`: those
descriptions are indexed for search, so naming a hidden argument there makes the tool findable by a
word the agent cannot send. Descriptions your DTOs already carry are not checked — you did not write
them while curating, and generic names like `type` would fire constantly.

The check is heuristic — a one-word name like `page` will fire on "page size" — so it is a warning.
Read it, then either fix the sentence or ignore that one.

Checking the name is not optional padding. A generated name carries `by_<path parameter>`, so
hiding a path parameter leaves `get_orders_by_tenant_id` naming something the agent cannot set.

## Produce several tools from one endpoint

When one endpoint serves two agent-facing jobs, declare a variant per job. Each one names itself
and describes itself, because a single description cannot honestly cover both.

```csharp
[McpToolVariant("list_open_orders", "Lists orders that are still open.")]
[McpArgument("status", Hidden = true, Value = "open", Variant = "list_open_orders")]
[McpToolVariant("list_archived_orders", "Lists archived orders.")]
[McpArgument("status", Hidden = true, Value = "archived", Variant = "list_archived_orders")]
public IActionResult Search([FromQuery] SearchQuery query) => ...;
```

```ts
@McpVariant({
  name: "list_open_orders",
  description: "Lists orders that are still open.",
  arguments: { status: hidden.value("open") },
})
@McpVariant({
  name: "list_archived_orders",
  description: "Lists archived orders.",
  arguments: { status: hidden.value("archived") },
})
search(@Query() query: SearchQuery) { ... }
```

Three things follow. A method that declares variants produces **only** its variants, never an extra
uncurated one. Variant names are absolute, so no container prefix is applied and a collision is
fatal at startup. And variants share the endpoint's authorization, so a narrowly curated variant is
not a narrower permission.

Variants also compete with each other in search: same route, adjacent descriptions, same keywords.
Make the **first clause** of each description different, because the search card truncates at 160
characters.

## Keep a query DTO grouped instead of flattened

By default a whole-object query binding is flattened: `ListOrdersQuery { Status, Min }` reaches the
agent as two unrelated top-level arguments. Turn that off and the DTO stays one argument:

```csharp
builder.Services.AddSkMcp(options =>
{
    options.Query.Grouping = QueryObjectGrouping.Group;
});
```

```ts
SkMcpModule.forRoot((options) => {
  options.query.grouping = "group";
});
```

The agent then sends `{"filter": {"status": "open", "min": 3}}`, and the SDK composes the form its
own backend binds — `?filter.status=open` on ASP.NET Core, `?filter[status]=open` on
NestJS/Express. Reach for it when two DTOs on one endpoint share a member name, or when
`[FromQuery(Name = "f")]` means the flattened keys are not the ones the model binder reads.

Three things to know before you switch it on:

- **It rewrites `inputSchema`.** Every affected tool's arguments change shape, and an agent's saved
  plan is written against the old one. It also renames the namespace curation is keyed by, so an
  `[McpArgument("Status", Name = "state")]` that pointed at a flattened leaf stops resolving and
  reports `curation_unresolved`.
- **NestJS needs Express's extended query parser.** Express 5 defaults to `simple`, which does not
  parse brackets. Call `app.set('query parser', 'extended')`; without it the first `search_tools`
  call fails with `query_parser_not_extended` rather than the tool composing filters the backend
  silently ignores. It is the first call and not boot because the NestJS catalog is built lazily;
  the ASP.NET catalog is built eagerly and reports its diagnostics at startup.
- **Only NestJS's named bindings group.** `@Query('filter') dto: FilterDto` groups;
  `@Query() dto: FilterDto` does not and never will, because Nest hands the bare form the whole
  query object. On ASP.NET Core both spellings group.

Members that cannot be a query value — a nested object, a dictionary — are left out and named in an
`unbound_query_object` warning. If nothing is left, the SDK declines to group and keeps today's
binding, so turning this on cannot make an endpoint disappear.

## What curation will not do

It will not add an argument your backend does not accept, narrow an argument's schema, reorder
arguments, or vary per caller. The published schema is the same for everyone; only the value of a
provider-filled argument changes from one caller to the next.

The normative rules are in `packages/spec/argument-curation.md`.
