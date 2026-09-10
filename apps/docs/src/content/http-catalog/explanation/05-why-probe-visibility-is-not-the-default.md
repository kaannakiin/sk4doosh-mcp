# Why probe visibility is not the default

Probe visibility answers "can this caller use this endpoint" by actually running the endpoint's
authorization against a synthetic request. It is more accurate than reading metadata. It is also
off by default, and the reason is a measurement, not a preference.

## How the question arose

One real backend integrated during this project put no `[Authorize]` metadata on any endpoint and
had no fallback policy. Authorization lived entirely in a custom JWT middleware. To the framework,
every endpoint looked anonymous.

The first version of the visibility rule treated an endpoint with no declaration as `allow`. On
that backend, 250 endpoints therefore appeared in search for everyone.

That was not a security hole — enforcement still ran in the middleware, and an anonymous caller
invoking one of them got a `401`. It was **list pollution**: the agent was shown 250 tools it
could not use, and found out one call at a time.

So the rule became three-valued. An endpoint with no readable declaration is now `unknown`, not
`allow`, and resolving `unknown` is what probing is for.

## The measured cost

The same backend, same search, 50 cards:

| Rule                        | Search time | `unknown` |
| --------------------------- | ----------- | --------- |
| Old (undeclared → `allow`)  | 1,180 ms    | 0         |
| Three-valued, probe enabled | 21,978 ms   | 664       |

Roughly nineteen times slower. The difference is that 251 endpoints that previously skipped
visibility work entirely now produce `unknown`, and the first 25 of them per search are really
executed.

## Read that number honestly

The bottleneck is not sk-mcp. On that host, every request opens a new NHibernate session — so each
probe pays a database session before any authorization runs. A backend with a cheaper request
prologue would show a much smaller gap.

The budget mechanism also worked as designed. `Visibility.ProbeTopK` capped probing at 25
candidates per search and `Visibility.ProbeConcurrency` ran four at a time; results are cached per
caller for `Cache.Lifetime` (30 seconds, 128 callers). Nothing ran away. What was expensive was
each individual probe inside the budget.

The conclusion is not "probing is slow." It is that probing multiplies your own per-request cost by
the budget, and you cannot know that number without measuring your host.

## Why this makes probe a rescue rather than a default

Turning probing on by default would mean every sk-mcp backend pays its own request prologue
multiplied by 25 on every search — including the backends that do not need it at all. A backend
whose endpoints declare authorization declaratively has nothing to probe: the metadata is already
readable, `unknown` is rare, and the budget is never touched.

So probing is a targeted rescue for backends whose authorization is invisible to the framework, and
it is opt-in because only its owner can decide the cost is acceptable.

## The cheaper exit

The one-line alternative is usually better than probing. If an endpoint really is anonymous,
`.AllowAnonymous()` says so, and the declarative tier resolves it for free. If a guard's check can
be summarized, `describeVisibility()` does the same on the NestJS side.

Both write one line in your framework instead of paying for a synthetic request on every search.
That is the recommendation: declare what you can, probe what you cannot, and measure before
assuming which one you are in.

## What probing still cannot do

An endpoint with no authorization declaration and no short-circuit point — a minimal API or route
handler that never reaches an authorization decision — cannot be probed at all. There is nothing to
observe. It stays `unknown` and is shown with `authUncertain`, which is the design working: the
uncertainty reaches the agent rather than being resolved by a guess.

And nothing here changes enforcement. A probe is a question about visibility; the answer never
gates a real call. That separation is
[why visibility is not enforcement](/docs/http-catalog/why-visibility-is-not-enforcement).
