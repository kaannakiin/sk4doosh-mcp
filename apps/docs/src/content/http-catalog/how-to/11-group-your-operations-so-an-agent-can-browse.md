# How to group your operations so an agent can browse

An agent facing a large catalog searches by keyword and hopes the wording matches. Tags give it a
second handle: a closed vocabulary it can read back out of an answer and then filter by, with no
guessing. Every operation already carries one tag, derived from its container. This page is about
choosing your own.

## What you get for free

With no declaration, an operation's tag is its container's name — the controller class, minus the
`Controller` suffix in NestJS. That is already useful: `search_tools` answers list the vocabulary,
and a caller can narrow to one controller's operations. It is also probably not the vocabulary you
would choose, because it follows your code layout rather than the job the agent is doing.

## Declare your own

```csharp
[HttpGet("orders")]
[McpTool(Name = "find_orders", Tags = new[] { "billing", "read" })]
public IActionResult List([FromQuery] ListOrdersQuery query) => ...;
```

```ts
@Get("orders")
@McpTool({ name: "find_orders", tags: ["billing", "read"] })
list(@Query() query: ListOrdersQuery) { ... }
```

Declare on the class instead of the method to cover every operation in it. The nearer declaration
wins, so a method that declares its own tags overrides the class, and a method that declares none
keeps the class's.

A declaration **replaces** the derived tag; it does not add to it. That is the point: a service
that groups four controllers under `billing` would otherwise publish four container names it never
chose alongside it. If you want the container name too, write it out.

`Tags` is `string[]` and needs `new[] { … }` — an attribute argument has to be a constant or an
array creation expression, and a C# collection expression is neither.

## Controllers you cannot decorate

For containers that come from a package, declare the rule centrally:

```csharp
builder.Services.AddLiaiso(options => options.Tags = container =>
    container.Contains("Billing") ? ["billing"] : null);
```

```ts
LiaisoModule.forRoot((options) => {
  options.tags = (container) =>
    container.includes("Billing") ? ["billing"] : undefined;
});
```

Returning null (or `undefined`) means "no rule here", and the container-derived tag stands. A
declaration on the operation or the container still wins over this rule.

## What the agent does with them

Every `search_tools` answer carries a `tags` field: the folded vocabulary of the operations that
caller may see. The agent reads a tag from there and sends it back:

```json
{ "query": "", "tags": ["billing"] }
```

The filter is a conjunction — a result carries every tag listed — and it narrows without reordering.
Matching is on the **whole tag**, ignoring case and accents: `billing` finds `Billing`, but `bill`
finds neither, and `Order Notes` is one tag rather than two. Two tags that differ only in case are
one tag to the filter, and the SDK reports the collision as `duplicate_tag` rather than silently
keeping both.

The vocabulary describes the visible catalog, not the result set, so an agent that narrowed to one
tag can still see the others and widen.

## One thing to watch

Tags are search text as well as filter keys. Replacing `Orders` with `billing` removes `order` as a
matching term for every operation in that container, so a query of `orders` that used to rank them
stops doing so. It also lengthens each document, which lowers every other term's score on it
slightly. Pick tags an agent would plausibly also type, and keep them short.
