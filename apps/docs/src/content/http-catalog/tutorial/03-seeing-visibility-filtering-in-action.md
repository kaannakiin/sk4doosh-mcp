# Seeing visibility filtering in action

In this tutorial you run an sk-mcp backend, connect to it as two different users, and watch the
same search return different tools for each of them. By the end you will have watched a tool
disappear for a caller who cannot use it, and seen what happens when that caller reaches for it
anyway.

You need the .NET SDK, Node.js 24+, and pnpm.

## 1. Build the agent client

From the repository root:

```bash
pnpm install
pnpm turbo run build --filter=@sk-mcp/agent-client
```

## 2. Start the demo backend

In a second terminal:

```bash
cd sdks/dotnet/samples/DemoApi
dotnet run
```

The backend listens on `http://127.0.0.1:5178`. Leave it running.

It exposes an orders API. One endpoint, `GET /orders/{id}`, is guarded by a policy named
`OrdersRead` that requires the caller to carry an `orders.read` claim.

## 3. Search as alice

Back in the first terminal:

```bash
SKMCP_AUTH=token SKMCP_USER=alice \
  node sdks/nestjs/samples/agent-client/dist/main.js --scenario smoke --query orders
```

alice carries the `orders.read` claim. Read the `search_tools` row:

```text
step                      ok    detail
tools/list                ok    load_tool, search_tools, invoke_tool
search_tools "orders"     ok    7/8 results
```

Eight tools exist for her, seven of them match the query.

## 4. Search as bob

Run the same command, changing one word:

```bash
SKMCP_AUTH=token SKMCP_USER=bob \
  node sdks/nestjs/samples/agent-client/dist/main.js --scenario smoke --query orders
```

```text
search_tools "orders"  ok    4/5 results
```

Five, not eight. bob is a real, authenticated user with a valid token — he just does not carry
`orders.read`. Three tools are gone from his world: `get_order`, `create_order`, and
`add_order_note`, the three the `OrdersRead` policy guards.

## 5. Ask bob to load the tool he cannot see

You know `get_order` exists, because alice saw it. Point bob straight at it:

```bash
SKMCP_AUTH=token SKMCP_USER=bob \
  node sdks/nestjs/samples/agent-client/dist/main.js --scenario smoke --query orders --tool get_order
```

```text
load_tool get_order    fail  {"error":"unknown_tool","message":"No operation named 'get_order'. Use search_tools to find the exact name.","retryable":false}
```

Not "forbidden". Not "exists but you may not use it". `unknown_tool` — the same answer, word for
word, that a name you invented would get. For bob, `get_order` does not exist.

## 6. Have bob call it anyway

The filter hid the tool. It did not lock it. Call it directly:

```bash
SKMCP_AUTH=token SKMCP_USER=bob \
  node sdks/nestjs/samples/agent-client/dist/main.js --scenario error-envelope --tool get_order \
  --arguments '{"id":1}'
```

```json
{
  "error": "forbidden",
  "message": "The caller is authenticated but not permitted to perform this operation (403).",
  "status": 403,
  "retryable": false
}
```

A 403, from your backend's own authorization, exactly as an HTTP client would get. `invoke_tool`
never consults the visibility filter.

## What you just saw

You changed nothing about the backend — no annotation, no tool registration, no filter code. You
changed which user was asking, and the answer changed. sk-mcp built a synthetic request for each
endpoint, ran the backend's own authentication and authorization against it, and kept what came
back allowed.

Two things are worth separating in your head, because the rest of the documentation depends on it:

- Step 5 was **visibility**. It is about what the agent is shown.
- Step 6 was **enforcement**. It is about what the backend permits, and it happened in your
  pipeline, not in sk-mcp.

The rules behind step 5 are on [visibility decision](/docs/http-catalog/visibility-decision). Why the two are
deliberately kept apart is on
[why visibility is not enforcement](/docs/http-catalog/why-visibility-is-not-enforcement).

To change what a caller sees in your own backend, go to
[how to control what a caller can see](/docs/http-catalog/control-what-a-caller-can-see).
