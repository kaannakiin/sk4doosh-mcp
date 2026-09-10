# How to forward the caller's identity

An agent call arrives at `/mcp` and is replayed as a synthetic request into your pipeline. For your
authentication to recognise the caller, the credential has to travel from the outer request onto
the synthetic one. This page covers the default, how to add a carrier, and what to do when the
credential is not a header at all.

## The default

`Authorization` is forwarded, and nothing else. If your backend authenticates from a bearer token
in that header — the common case — you configure nothing and identity already works.

sk-mcp forwards the credential **unchanged**. It does not mint, refresh, exchange or rewrite
tokens. A `401` from your pipeline means your authentication rejected the caller's real
credential; retrying the same MCP session will not change that.

## Add a carrier

Cookie-based sessions, an API-key header, a tenant header your middleware reads — any of these has
to be named explicitly.

```csharp
builder.Services.AddSkMcp(options =>
{
    options.Identity.Forward("Cookie");
    options.Identity.Forward("X-Api-Key");
});
```

```ts
SkMcpModule.forRoot((options) => {
  options.identity.forward("cookie").forward("x-api-key");
});
```

Both are fluent and both are additive — `Authorization` stays unless you drop it. Names are
case-insensitive. To forward nothing at all, `Clear()` / `clear()` first, then add what you want.

Keep the list short. Every forwarded header is a header your endpoints see on a request they did
not originate, so forward what authentication needs and stop there.

## When the credential is not a header

Some backends resolve identity in their own middleware from something the outer request carries
but the synthetic request cannot inherit by name — a value already parsed onto the request object,
a per-tenant connection, a claim assembled from several sources. For that, project it yourself:

```csharp
options.Identity.Project((outer, synthetic) =>
{
    synthetic.Headers["X-Tenant"] = outer.HttpContext.Items["tenant"]?.ToString();
});
```

```ts
options.identity.project((outer, syntheticHeaders) => {
  syntheticHeaders["x-tenant"] = resolveTenant(outer);
});
```

The projector runs once per synthetic request with the outer request in hand. It is the escape
hatch for hosts whose authorization does not live in `[Authorize]` or in guards — write the value
into a header your middleware already understands, rather than teaching sk-mcp about your identity
model.

## Verify the result

Call an endpoint that echoes the caller. The samples in this repository have one:

```bash
SKMCP_USER=alice node sdks/nestjs/samples/agent-client/dist/main.js \
  --scenario smoke --query identity --tool orders_me --arguments '{}'
```

```text
search_tools "identity"  ok    3/8 results
load_tool orders_me      ok    {"type":"object","properties":{},"required":[],"additionalProperties":false}
invoke_tool orders_me    ok    {"status":200,"body":{"name":"alice"}}
```

The body names the caller, so the credential arrived and your authentication read it. A `401` means
it did not — check that the header your scheme reads is in the carrier list.

An endpoint carrying a policy is the stronger test: it proves the identity was not merely present
but also authorized. `get_order` behind `OrdersRead` is that test in the
[visibility tutorial](/docs/http-catalog/seeing-visibility-filtering-in-action).

## What this cannot do

Forwarding does not elevate. The synthetic request carries the same credential the agent presented,
so an agent acting as `bob` is `bob` inside your pipeline. There is no service identity, no
impersonation, and no way for sk-mcp to widen what the caller can do — which is the property that
makes the visibility filter safe to be approximate.
