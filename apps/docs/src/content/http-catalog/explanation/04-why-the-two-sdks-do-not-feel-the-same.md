# Why the two SDKs do not feel the same

The ASP.NET Core SDK maps the MCP endpoint for you in one call and filters search results from
metadata with no configuration. The NestJS SDK makes you write the controller by hand and needs
your guards to declare themselves before filtering works at all.

That asymmetry is not an incomplete port. It follows from a real difference between the two
frameworks, and the honest version is worth understanding before you fight it.

## Enforcement is symmetric

Start with what is the same, because it is the larger half.

Both SDKs enforce identically, and neither one reads your authorization hierarchy to do it. A tool
call is replayed as a synthetic request into your own pipeline; the framework then applies global,
controller and endpoint-level authorization exactly as it would for an HTTP request. sk-mcp does
not know what that chain contains and does not need to.

So the property that matters most — a tool call cannot do more than an HTTP call by the same caller
— holds in both, and holds for free.

## Visibility is where they diverge

Filtering search results is the one place that needs the _effective_ authorization of an endpoint,
before any request exists. That is where the frameworks stop being interchangeable.

**ASP.NET Core has already flattened it.** When routing is built, each endpoint's `Metadata`
collection merges authorization data from all three levels into one flat list. The SDK reads a
result the framework computed:

```csharp
endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>()
```

Combining those is a framework call too, and the combination is an AND — every level's requirement
must pass. So the SDK evaluates one combined policy against the caller and gets an answer. No
inference, no guessing: the hierarchy was never resolved by sk-mcp, it was read.

**NestJS exposes the binding but not the meaning.** Nest also has three levels — `APP_GUARD`,
`@UseGuards` on the class, `@UseGuards` on the method — and `Reflector` plus the DI container will
tell you exactly which guards apply. The hierarchy is visible.

But an ASP.NET policy is _declarative_: a claim requirement is data you can read. A Nest guard is
_imperative_: `canActivate` is code. It can query a database, call a service, check the clock. What
it checks cannot be known statically, by sk-mcp or by anything else.

## What that forces

Everything awkward about the NestJS SDK traces back to that one sentence.

`describeVisibility()` exists because a guard has to volunteer what it enforces — there is no
metadata to read instead. It is opt-in because most guards do not have it, and a guard that lacks
it makes its endpoint `unknown` rather than letting sk-mcp assume. Assuming would be the actual
bug: assuming `allow` pollutes search with tools the caller cannot use, assuming `deny` hides tools
they can.

The probe tier exists as the fallback for guards that cannot or will not declare themselves. It
answers the question by _running_ the guards against a synthetic request and reading the verdict —
the same evaluation ASP.NET gets from `IAuthorizationService`, obtained the expensive way. That it
costs real requests is why
[probe is not the default](/docs/http-catalog/why-probe-visibility-is-not-the-default).

The hand-written MCP controller has a smaller cause but the same flavour. `MapSkMcp` can add an
endpoint because ASP.NET routes are data a library can contribute to. A Nest controller is a class
you own, and a module cannot add a route to it — so the seven injections are yours to wire. This is
the one difference that is arguably fixable; the visibility ones are not.

## Where both are equally limited

Resource-based authorization — "is this caller the order's owner?" — works at invoke time in both,
because the handler runs and the resource exists. Neither can evaluate it at list time, because
there is no resource and no arguments yet.

That is not a framework difference; it is the shape of the problem. The rule both SDKs follow is
the same: such endpoints stay visible in search, and the call is rejected at invoke time if it
must be. It is the same rule that makes
[visibility not enforcement](/docs/http-catalog/why-visibility-is-not-enforcement), arrived at
from the other direction.

## What this means for you

If your backend declares authorization declaratively, the two SDKs feel nearly the same and you
pay nothing. If it does not — imperative guards on Nest, or authorization living in custom
middleware on either — the visibility layer is where you will feel it, and the fix is one line in
your framework rather than configuration in sk-mcp:
[declare the guard](/docs/http-catalog/declare-visibility-for-a-nestjs-guard).
