# How to control what a caller can see

You want a specific endpoint to appear, or not appear, in `search_tools` results for a specific
caller. There is no sk-mcp switch for this. You change the endpoint's own authorization, and
visibility follows.

## Hide an endpoint from callers without a claim

Guard it with a policy your framework can evaluate before the handler runs:

```csharp
[HttpGet("/orders/{id:int}")]
[Authorize(Policy = "OrdersRead")]
public IActionResult GetOrder(int id) => ...;
```

Callers who fail `OrdersRead` get a `deny` decision and never see the tool. Callers who pass see it
normally.

## Show an endpoint to everyone

Mark it anonymous. sk-mcp reads the framework's own anonymous marker:

```csharp
[HttpGet("/ping")]
[AllowAnonymous]
public IActionResult Ping() => Ok(new { pong = true });
```

## Understand why a tool shows up as uncertain

If a tool appears with `authUncertain: true`, sk-mcp could not decide. It is showing you the tool
rather than guessing in either direction. The usual causes:

| Cause                                                                   | Fix                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| The endpoint checks authorization inside the handler, not declaratively | Move the resource-independent part of the check to an attribute or guard |
| Your backend has no authentication scheme sk-mcp can run                | Nothing to fix — the decision is honestly unknown                        |
| A policy did not report a result                                        | Make the policy evaluable without a resource                             |

Resource-dependent checks — row-level ownership, "can this user see _this_ order" — are supposed to
stay in the handler. Visibility only evaluates the resource-independent gate and defers the rest to
invoke time. Do not restructure your handler to satisfy the filter.

## Verify the result

Run a search as each caller and compare. With the demo backend:

```bash
SKMCP_AUTH=token SKMCP_USER=alice \
  node apps/example-agent-client/dist/main.js --scenario smoke --query orders
```

Change `SKMCP_USER` to see a different slice. The demo users differ only in their claims, and the
tool list follows:

| Caller  | Claims        | Tools visible | Extra over `bob`                              |
| ------- | ------------- | ------------- | --------------------------------------------- |
| `alice` | `orders.read` | 8             | `get_order`, `create_order`, `add_order_note` |
| `carol` | `admin` role  | 6             | `orders_audit`                                |
| `bob`   | none          | 5             | —                                             |

The five tools everyone sees are the anonymous ones and the ones that need identity alone.

## What this cannot do

Hiding a tool does not protect it. `invoke_tool` never consults the visibility filter — a caller
who guesses a tool name reaches the real pipeline and is rejected there, by your backend, exactly
as an HTTP client would be. If you are using visibility as a security control, read
[why visibility is not enforcement](/docs/why-visibility-is-not-enforcement) before going further.
