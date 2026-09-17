# How to tell the agent what a tool returns

An agent that knows only a tool's arguments has to call it to find out what comes back. That is
fine for one call and expensive for a plan: "fetch the order, take its `customerId`, fetch the
customer" needs the shape of the first response before the second call can be chosen.

`load_tool` publishes an `outputSchema` when the endpoint declares a success body. Where that
declaration comes from differs between the two SDKs, and the difference is not a design choice.

## ASP.NET Core: it is already there

Response types are read from ApiExplorer, so an endpoint that documents itself for Swagger is
already done:

```csharp
[HttpGet("/orders/{id:int}")]
[ProducesResponseType(typeof(OrderResponse), StatusCodes.Status200OK)]
[ProducesResponseType(StatusCodes.Status404NotFound)]
[Authorize(Policy = "OrdersRead")]
public IActionResult GetOrder(int id) => ...;
```

`Produces<T>()` on a minimal API and a return type MVC can infer work the same way. Nothing on
`[McpTool]` controls this.

## NestJS: declare it

TypeScript erases generics before the type reaches runtime. A handler declared
`async getOrder(): Promise<OrderResponse>` reports `Promise` to `design:returntype`, and
`OrderResponse[]` reports `Array` — neither names the type you wrote. So the response type has to be
declared:

```ts
@Get("orders/:id")
@McpTool({
  description: "Fetches one order by id.",
  responses: { 200: OrderResponse, 404: {} },
})
getOrder(@Param("id", ParseIntPipe) id: number): OrderResponse { ... }
```

Four forms are accepted per status code:

| Form                | Meaning                                                       |
| ------------------- | ------------------------------------------------------------- |
| `OrderResponse`     | a DTO class, read the same way a request body's class is read |
| `[OrderResponse]`   | a collection of it                                            |
| `{ schema: { … } }` | a JSON Schema used verbatim, for a shape no class can express |
| `{}`                | the status carries no body                                    |

A DTO class needs class-validator decorators, exactly as a request DTO does; without them its shape
cannot be read and a diagnostic says so.

If you already annotate with `@nestjs/swagger`, you do not have to write the declaration twice —
`@ApiOkResponse({ type: OrderResponse })` is read as a fallback. A sync handler with a plain class
return type is read from `design:returntype` as a last resort. The order is: the `responses`
declaration wins, then Swagger metadata, then the inferred return type.

## What the agent gets

```json
{
  "name": "get_order",
  "inputSchema": {
    "type": "object",
    "properties": { "id": { "type": "integer" } },
    "...": "..."
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "integer" },
      "item": { "type": "string" },
      "quantity": { "type": "integer" },
      "owner": { "type": "string" }
    },
    "required": ["id", "item", "quantity", "owner"]
  }
}
```

Three things to know about the shape:

- **One status wins.** `200`, `201`, `202`, `204` are tried in that order, then the lowest remaining
  `2xx`. Declaring error statuses is useful documentation but does not change `outputSchema`.
- **A non-object root is wrapped.** MCP requires the root to be an object, so an endpoint returning
  a list publishes `{"type":"object","properties":{"result":{"type":"array",…}},"required":["result"]}`.
- **Read-only members survive.** A property your request schema drops because the caller cannot set
  it is exactly the property a response is made of, so the response side keeps it.

An endpoint that returns `204`, or declares no `2xx` at all, publishes no `outputSchema` — the key is
absent rather than empty.

## What it does not do

`outputSchema` is published on `load_tool` only. It is not enforced against what
`invoke_tool` actually returns: `invoke_tool` is one fixed tool whose result shape changes per call,
so a client cannot validate it against a static schema. Treat `outputSchema` as what the backend
says it returns, the same status a Swagger document has.

Argument curation does not reach it either. Renaming or hiding an argument changes the tool's input
surface; response fields are not arguments, so every variant of one operation publishes the same
`outputSchema`.
