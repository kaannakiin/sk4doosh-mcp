# Meta-tool contract

`tools/list` returns exactly three tools, whatever the catalog contains. The two SDKs emit
byte-identical names, descriptions and input schemas.

> **Source of truth.** The search and card semantics are normative in
> [`packages/spec/search-semantics.md`](https://github.com/kaannakiin/sk4doosh-mcp/blob/main/packages/spec/search-semantics.md)
> and the loaded tool's shape in
> [`tool-definition.schema.json`](https://github.com/kaannakiin/sk4doosh-mcp/blob/main/packages/spec/schemas/tool-definition.schema.json);
> where they differ from this page, they win.

## The three tools

```text
load_tool, search_tools, invoke_tool
```

Every one of them carries a `_meta` stamp naming the catalog generation it was listed for:

```json
{ "sk-mcp/catalogGeneration": 0 }
```

When the catalog reloads, the number changes and the server sends `notifications/tools/list_changed`.
A client that caches tool definitions can compare the stamp instead of diffing them.

## `search_tools`

```json
{
  "type": "object",
  "properties": {
    "query": {
      "description": "Keywords matched by prefix against operation names, descriptions, tags and routes. Empty lists everything.",
      "type": "string",
      "default": ""
    },
    "limit": {
      "description": "Maximum number of results, 1-50.",
      "type": "integer",
      "default": 20
    }
  }
}
```

`limit` is clamped to `1..50` rather than rejected, so an out-of-range value returns results
instead of an error.

The result is a total and a list of compact cards:

```json
{
  "total": 8,
  "results": [
    {
      "name": "create_order",
      "description": "Creates a new order.",
      "parameters": "item: string (required), quantity: integer"
    },
    {
      "name": "get_order",
      "description": "Fetches one order by id.",
      "parameters": "id: integer (required)"
    }
  ]
}
```

`total` counts what the caller may see, before `limit` is applied. `parameters` is a one-line
rendering of the input schema's top level, not the schema — an agent that intends to call has to
`load_tool` first. Card descriptions are truncated at 160 characters on a word boundary.

A card gains `authUncertain: true` when visibility could not be resolved for that caller. The card
never carries policy names; see [visibility decision](/docs/http-catalog/visibility-decision).

## `load_tool`

Takes `name`, exactly as `search_tools` returned it.

```json
{
  "name": "get_order",
  "description": "Fetches one order by id.",
  "inputSchema": {
    "type": "object",
    "properties": { "id": { "type": "integer", "description": "Order id" } },
    "required": ["id"],
    "additionalProperties": false
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
  },
  "annotations": { "readOnlyHint": true, "idempotentHint": true }
}
```

`inputSchema` is always a flat object: path, query, header and body members are all top-level
arguments. How a backend type becomes that schema is
[schema conversion](/docs/http-catalog/schema-conversion).

`outputSchema` is what the call returns, so an agent can plan a chain of calls before making the
first one. It is present only when the endpoint declares a success body: the status codes `200`,
`201`, `202` and `204` are tried in that order, then the lowest remaining `2xx`, and a `204` or an
endpoint with no `2xx` at all publishes no `outputSchema`. A response whose root is not an object —
an array, a scalar — is wrapped as `{"type":"object","properties":{"result":…},"required":["result"]}`,
because MCP requires the root to be an object.

Unlike `inputSchema`, a response schema keeps read-only members: a get-only property is a response
field precisely because the server is the one that computes it. Curation does not reach
`outputSchema` either, so every variant of one operation publishes the same one. Where the
declaration comes from is
[telling the agent what a tool returns](/docs/http-catalog/tell-the-agent-what-a-tool-returns).

`annotations` carries only the hints that apply — the field is omitted rather than filled with
`false`. `load_tool` is subject to visibility: a tool the caller cannot see returns `unknown_tool`,
so a hidden tool and a nonexistent one are indistinguishable. `auth` is never included.

## `invoke_tool`

Takes `name` and `arguments`, an object whose keys are the input schema's properties. The call runs
through the backend's own pipeline with the caller's identity.

Success returns the HTTP result:

```json
{
  "status": 200,
  "body": {
    "id": 1,
    "item": "mechanical keyboard",
    "quantity": 2,
    "owner": "alice"
  }
}
```

Failure returns an error envelope with `isError` set. Both layers of that are on
[invoke result envelope](/docs/http-catalog/invoke-result-envelope).

## The envelope every result shares

Results are always JSON serialized into a **single text content block**:

```ts
const payload = JSON.parse(result.content[0].text);
```

There is no `structuredContent` and no multi-block result. `isError` is `true` on failure and
**absent** on success — test it for truthiness, not for `false`.

## Session mode

The transport is Streamable HTTP. The default session mode is `stateless`: `POST` only, JSON
responses, no `Mcp-Session-Id`, `GET` and `DELETE` answered with `405`. In `stateful` mode the
server issues a session id on `initialize`, requires it on follow-up requests, and keeps SSE
streams alive. `sessionMode` is a NestJS option; the .NET SDK exposes no equivalent property.
