# How to keep a response from flooding the agent

A list endpoint with no pagination is harmless to your backend and fatal to an agent. One
`GET /orders` that returns 40 000 rows does not slow the server down; it fills the agent's context,
and the agent cannot undo that. The damage is done by the time the call returns.

sk-mcp puts a budget and a deadline on every invocation. Both have defaults that work, so this page
is mostly about what the agent sees when a guard fires, and when to change the numbers.

## What the agent gets when a response is too large

The response is **refused, not truncated**. No prefix, no preview:

```json
{
  "error": "response_too_large",
  "message": "The response is 1843200 bytes; the limit is 262144 bytes. It is refused, not truncated: no part of the body was returned. The body is an array of 8412 items. Narrow it and call again: limit, status.",
  "retryable": false,
  "payload": {
    "bytes": 1843200,
    "limit": 262144,
    "shape": { "kind": "array", "count": 8412 }
  },
  "fields": [
    { "name": "limit", "message": "Maximum number of rows to return." },
    { "name": "status", "message": "Filters by order status." }
  ]
}
```

Two things make this recoverable. `shape` tells the agent how big the answer actually was — often
enough to answer "how many refunds are there?" without calling again. And `fields` names **your**
endpoint's narrowing arguments, read from its published input schema, so the retry is a specific
one rather than a guess.

A preview would have been worse on every axis: it spends the whole budget the guard exists to
protect, it still forces a second call because a truncated array cannot be reasoned over, and it
tempts the agent into answering from a fragment.

Nothing from the body is forwarded. `count` is a fact about the value, not a string taken from it,
so the leak-prevention rules hold by construction.

## What the agent gets when the backend is slow

```json
{
  "error": "invoke_timeout",
  "message": "The backend did not answer within 30000 ms and the call was abandoned. The operation may already have been applied; re-read before retrying.",
  "retryable": true
}
```

Read the second sentence literally. **A timeout frees the agent; it does not cancel your handler.**
sk-mcp delivers a cancellation signal — a client disconnect on Node, `RequestAborted` on ASP.NET —
but neither runtime preempts running code. A handler that does not observe its signal runs to
completion and its result is discarded. A write it already committed stays committed.

If you want a timeout to actually stop work, your handler has to cooperate:

```csharp
[HttpGet("/reports/heavy")]
public async Task<IActionResult> Heavy(CancellationToken cancellationToken) =>
    Ok(await _db.Reports.ToListAsync(cancellationToken));
```

```ts
@Get("reports/heavy")
heavy(@Req() request: Request) {
  return this.reports.load({ signal: AbortSignal.any([request.signal]) });
}
```

On ASP.NET this is usually free, because `CancellationToken` is already threaded through EF Core
and `HttpClient`. On Node it usually is not, because `AbortSignal` is not conventional in Nest
handler signatures. That is an ecosystem difference, not a platform one.

## Changing the numbers

```ts
SkMcpModule.forRoot((options) => {
  options.invoke.maxResponseBytes = 512 * 1024;
  options.invoke.timeoutMs = 10_000;
});
```

```csharp
builder.Services.AddSkMcp(options =>
{
    options.Invoke.MaxResponseBytes = 512 * 1024;
    options.Invoke.Timeout = TimeSpan.FromSeconds(10);
});
```

Defaults are 262 144 bytes and 30 000 ms, identical in both SDKs.

**Do not raise the timeout above one minute.** A stock MCP client has its own 60-second request
timeout and cancels first, so a larger number is unreachable — you get the client's behaviour, and
the agent gets a protocol-level cancellation instead of your envelope.

### One endpoint at a time

A report endpoint that legitimately returns megabytes should not force the budget up for everything
else. Both SDKs take a delegate over the invoked endpoint:

```ts
options.invoke.maxResponseBytesFor = (target) =>
  target.route.startsWith("/reports/") ? 4 * 1024 * 1024 : undefined;
```

```csharp
options.Invoke.MaxResponseBytesFor = target =>
    target.Route.StartsWith("/reports/", StringComparison.Ordinal) ? 4 * 1024 * 1024 : null;
```

Returning `undefined`/`null` falls back to the global value. There is one override step, not a
layered ladder — this is a property of your deployment, not of the endpoint, so two hosts serving
the same API are free to disagree.

## The guard you cannot turn off

Every meta-tool answer passes the budget, not just `invoke_tool`. That includes `load_tool`, and it
is worth knowing why: an operation whose DTO is deep enough has an input schema large enough to
flood the agent on its own, and no argument narrows a schema. If you hit that, the fix is the schema
depth budget, not a larger response budget.

The normative rules are in
[invoke-semantics.md](https://github.com/kaannakiin/sk-mcp/blob/main/packages/http/spec/invoke-semantics.md).
